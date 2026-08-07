from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID, uuid4

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.orm import Session

from memora.alignment.models import (
    AlignmentPosition,
    AlignmentPositionSource,
    AlignmentTopic,
    DecisionRecord,
)
from memora.alignment.schemas import (
    AlignmentPositionResponse,
    AlignmentTopicResponse,
    CreateAlignmentRequest,
    DecisionRecordResponse,
    PositionStatus,
    PublishDecisionRequest,
    UpdateAlignmentPositionRequest,
)
from memora.audit.models import AuditEvent
from memora.billing.service import consume_credits
from memora.conversations.service import excerpt_for
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.memories.service import (
    add_private_memory_with_processing,
    authorized_memories_statement,
)
from memora.retrieval.schemas import EvidenceCitationResponse, evidence_citation_for
from memora.settings import Settings
from memora.visuals.service import task_credit_costs
from memora.workspaces.models import Workspace, WorkspaceMembership


class AlignmentAccessError(PermissionError):
    pass


def _require_collaborative_workspace(database: Session, principal: Principal) -> None:
    kind = database.scalar(select(Workspace.kind).where(Workspace.id == principal.workspace_id))
    if kind not in {"TEAM", "FAMILY"}:
        raise ValueError("观点对齐只适用于团队或家庭空间")


def accessible_alignment_topics_statement(
    principal: Principal,
) -> Select[tuple[AlignmentTopic]]:
    return select(AlignmentTopic).where(AlignmentTopic.workspace_id == principal.workspace_id)


def get_accessible_alignment_topic(
    database: Session,
    principal: Principal,
    topic_id: UUID,
) -> AlignmentTopic | None:
    return cast(
        AlignmentTopic | None,
        database.scalar(
            accessible_alignment_topics_statement(principal).where(AlignmentTopic.id == topic_id)
        ),
    )


def _participant_users(
    database: Session,
    principal: Principal,
    participant_ids: list[UUID],
) -> list[User]:
    rows = database.scalars(
        select(User)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(
            WorkspaceMembership.workspace_id == principal.workspace_id,
            User.status == "ACTIVE",
        )
        .order_by(User.display_name.asc(), User.id.asc())
    ).all()
    if not participant_ids:
        return list(rows)
    requested = set(participant_ids)
    by_id = {user.id: user for user in rows}
    if not requested.issubset(by_id):
        raise AlignmentAccessError("参与者必须是当前空间成员")
    requested.add(principal.user_id)
    return [user for user in rows if user.id in requested]


def _candidate_memories(
    database: Session,
    principal: Principal,
    user_id: UUID,
    title: str,
    created_from: datetime,
    created_to: datetime,
) -> list[Memory]:
    terms = [term for term in title.replace("，", " ").replace("、", " ").split() if len(term) >= 2]
    statement = select(Memory).where(
        Memory.workspace_id == principal.workspace_id,
        Memory.author_id == user_id,
        Memory.visibility == "WORKSPACE",
        Memory.body.is_not(None),
        Memory.deleted_at.is_(None),
        Memory.created_at >= created_from,
        Memory.created_at < created_to,
    )
    if terms:
        statement = statement.where(
            or_(*(func.lower(Memory.body).contains(term.lower()) for term in terms))
        )
    return list(database.scalars(statement.order_by(Memory.created_at.desc()).limit(6)).all())


def create_alignment_topic(
    database: Session,
    principal: Principal,
    payload: CreateAlignmentRequest,
    settings: Settings,
) -> AlignmentTopic:
    _require_collaborative_workspace(database, principal)
    participants = _participant_users(database, principal, payload.participant_ids)
    now = datetime.now(UTC)
    created_from = payload.created_from or (now - timedelta(days=90))
    created_to = payload.created_to or (now + timedelta(seconds=1))
    topic = AlignmentTopic(
        workspace_id=principal.workspace_id,
        created_by_user_id=principal.user_id,
        title=payload.title,
        context=payload.context,
        status="OPEN",
        evidence_from=created_from,
        evidence_to=created_to,
    )
    database.add(topic)
    database.flush()
    for user in participants:
        memories = _candidate_memories(
            database,
            principal,
            user.id,
            payload.title,
            created_from,
            created_to,
        )
        position = AlignmentPosition(
            topic_id=topic.id,
            user_id=user.id,
            text=(
                "\n\n".join(excerpt_for(memory.body or "", max_length=420) for memory in memories)
                if memories
                else None
            ),
            status="CANDIDATE" if memories else "NO_RECORDED_POSITION",
        )
        database.add(position)
        database.flush()
        for memory in memories:
            database.add(AlignmentPositionSource(position_id=position.id, memory_id=memory.id))
    consume_credits(
        database,
        principal.user_id,
        task_credit_costs(settings)["alignment"],
        idempotency_key=f"alignment:{topic.id}",
        reference_type="ALIGNMENT_TOPIC",
        reference_id=str(topic.id),
    )
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="ALIGNMENT_TOPIC_CREATED",
            resource_type="ALIGNMENT_TOPIC",
            resource_id=topic.id,
        )
    )
    database.flush()
    return topic


def update_own_position(
    database: Session,
    principal: Principal,
    topic: AlignmentTopic,
    position_id: UUID,
    payload: UpdateAlignmentPositionRequest,
) -> AlignmentPosition:
    if topic.status != "OPEN":
        raise ValueError("已形成决策的议题不能再修改观点")
    position = database.scalar(
        select(AlignmentPosition).where(
            AlignmentPosition.id == position_id,
            AlignmentPosition.topic_id == topic.id,
        )
    )
    if position is None:
        raise ValueError("观点不存在")
    if position.user_id != principal.user_id:
        raise AlignmentAccessError("成员只能确认或修改自己的观点")
    now = datetime.now(UTC)
    if payload.action == "CONFIRM":
        if position.status == "NO_RECORDED_POSITION" or not position.text:
            raise ValueError("当前没有可确认的观点，请先填写自己的观点")
        position.status = "CONFIRMED"
        position.confirmed_at = now
    elif payload.action == "REVISE":
        position.text = (payload.text or "").strip()
        position.status = "REVISED"
        position.confirmed_at = now
        database.execute(
            delete(AlignmentPositionSource).where(
                AlignmentPositionSource.position_id == position.id
            )
        )
    else:
        position.text = None
        position.status = "WITHDRAWN"
        position.confirmed_at = now
        database.execute(
            delete(AlignmentPositionSource).where(
                AlignmentPositionSource.position_id == position.id
            )
        )
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action=f"ALIGNMENT_POSITION_{payload.action}",
            resource_type="ALIGNMENT_POSITION",
            resource_id=position.id,
        )
    )
    database.flush()
    return position


def _position_citations(
    database: Session,
    principal: Principal,
    position: AlignmentPosition,
) -> tuple[bool, list[EvidenceCitationResponse]]:
    source_ids = list(
        database.scalars(
            select(AlignmentPositionSource.memory_id).where(
                AlignmentPositionSource.position_id == position.id
            )
        ).all()
    )
    if not source_ids:
        return True, []
    rows = database.execute(
        authorized_memories_statement(principal).where(
            Memory.id.in_(source_ids),
            Memory.visibility == "WORKSPACE",
        )
    ).tuples()
    by_id = {memory.id: (memory, author) for memory, author, _projection in rows}
    if set(by_id) != set(source_ids):
        return False, []
    return True, [
        evidence_citation_for(
            by_id[memory_id][0],
            by_id[memory_id][1],
            excerpt=excerpt_for(by_id[memory_id][0].body or ""),
        )
        for memory_id in source_ids
    ]


def _decision_response(decision: DecisionRecord) -> DecisionRecordResponse:
    return DecisionRecordResponse(
        id=decision.id,
        decision=decision.decision,
        rationale=decision.rationale,
        alternatives=decision.alternatives,
        position_snapshot=decision.position_snapshot,
        review_at=decision.review_at,
        memory_id=decision.memory_id,
        supersedes_id=decision.supersedes_id,
        published_by_user_id=decision.published_by_user_id,
        created_at=decision.created_at,
    )


def alignment_topic_response(
    database: Session,
    principal: Principal,
    topic: AlignmentTopic,
) -> AlignmentTopicResponse:
    positions = database.scalars(
        select(AlignmentPosition)
        .where(AlignmentPosition.topic_id == topic.id)
        .order_by(AlignmentPosition.created_at.asc(), AlignmentPosition.id.asc())
    ).all()
    users = {
        user.id: user
        for user in database.scalars(
            select(User).where(User.id.in_([position.user_id for position in positions]))
        ).all()
    }
    position_responses: list[AlignmentPositionResponse] = []
    expressed: list[str] = []
    unresolved = False
    for position in positions:
        sources_available, citations = _position_citations(database, principal, position)
        source_dependent = position.status in {"CANDIDATE", "CONFIRMED"}
        visible_status = position.status
        visible_text = position.text
        if source_dependent and not sources_available:
            visible_status = "NO_RECORDED_POSITION"
            visible_text = None
            citations = []
        if visible_status in {"CONFIRMED", "REVISED"} and visible_text:
            expressed.append(" ".join(visible_text.lower().split()))
        else:
            unresolved = True
        user = users.get(position.user_id)
        position_responses.append(
            AlignmentPositionResponse(
                id=position.id,
                user_id=position.user_id,
                display_name=user.display_name if user is not None else "已移除成员",
                status=cast(PositionStatus, visible_status),
                text=visible_text,
                is_current_user=position.user_id == principal.user_id,
                citations=citations,
                confirmed_at=position.confirmed_at,
                updated_at=position.updated_at,
            )
        )
    if not expressed or unresolved:
        summary_status = "INSUFFICIENT_EVIDENCE"
    elif len(set(expressed)) == 1:
        summary_status = "CONSENSUS"
    else:
        summary_status = "DIFFERENCES"
    decisions = database.scalars(
        select(DecisionRecord)
        .where(DecisionRecord.topic_id == topic.id)
        .order_by(DecisionRecord.created_at.desc(), DecisionRecord.id.desc())
    ).all()
    return AlignmentTopicResponse(
        id=topic.id,
        title=topic.title,
        context=topic.context,
        status=cast(Literal["OPEN", "DECIDED", "ARCHIVED"], topic.status),
        summary_status=cast(
            Literal["CONSENSUS", "DIFFERENCES", "INSUFFICIENT_EVIDENCE"],
            summary_status,
        ),
        is_owner=topic.created_by_user_id == principal.user_id,
        can_publish_decision=principal.role == "OWNER",
        evidence_from=topic.evidence_from,
        evidence_to=topic.evidence_to,
        positions=position_responses,
        decisions=[_decision_response(decision) for decision in decisions],
        created_at=topic.created_at,
        updated_at=topic.updated_at,
    )


def _decision_markdown(
    topic: AlignmentTopic,
    payload: PublishDecisionRequest,
    positions: list[AlignmentPosition],
    users: dict[UUID, User],
) -> str:
    lines = [
        f"# 决策：{topic.title}",
        "",
        "## 决定",
        "",
        payload.decision,
        "",
        "## 理由",
        "",
        payload.rationale,
    ]
    if payload.alternatives:
        lines.extend(["", "## 备选方案", ""])
        lines.extend(f"- {alternative}" for alternative in payload.alternatives)
    lines.extend(["", "## 成员观点与保留意见", ""])
    for position in positions:
        user = users.get(position.user_id)
        display_name = user.display_name if user is not None else "已移除成员"
        text = position.text or "未记录观点"
        lines.append(f"- {display_name}（{position.status}）：{text}")
    if payload.review_at is not None:
        lines.extend(["", "## 复盘时间", "", payload.review_at.isoformat()])
    return "\n".join(lines)[:10_000]


def publish_decision(
    database: Session,
    principal: Principal,
    topic: AlignmentTopic,
    payload: PublishDecisionRequest,
) -> DecisionRecord:
    if principal.role != "OWNER":
        raise AlignmentAccessError("只有空间管理员可以发布最终决策")
    if payload.review_at is not None and payload.review_at.tzinfo is None:
        raise ValueError("复盘时间必须包含时区")
    superseded = None
    if payload.supersedes_id is not None:
        superseded = database.scalar(
            select(DecisionRecord).where(
                DecisionRecord.id == payload.supersedes_id,
                DecisionRecord.topic_id == topic.id,
            )
        )
        if superseded is None:
            raise ValueError("被替代的决策不存在")
    positions = list(
        database.scalars(
            select(AlignmentPosition)
            .where(AlignmentPosition.topic_id == topic.id)
            .order_by(AlignmentPosition.created_at.asc())
        ).all()
    )
    users = {
        user.id: user
        for user in database.scalars(
            select(User).where(User.id.in_([position.user_id for position in positions]))
        ).all()
    }
    snapshot: list[dict[str, object]] = []
    for position in positions:
        user = users.get(position.user_id)
        snapshot.append(
            {
                "user_id": str(position.user_id),
                "display_name": user.display_name if user is not None else "已移除成员",
                "status": position.status,
                "text": position.text,
            }
        )
    memory_id = uuid4()
    memory, _projection = add_private_memory_with_processing(
        database,
        principal,
        memory_id=memory_id,
        body=_decision_markdown(topic, payload, positions, users),
        supersedes_id=superseded.memory_id if superseded is not None else None,
        timeline_entry_id=memory_id,
        revision_kind="NEW_VERSION" if superseded is not None else "ROOT",
    )
    memory.visibility = "WORKSPACE"
    memory.shared_at = datetime.now(UTC)
    decision = DecisionRecord(
        topic_id=topic.id,
        workspace_id=principal.workspace_id,
        published_by_user_id=principal.user_id,
        memory_id=memory.id,
        supersedes_id=superseded.id if superseded is not None else None,
        decision=payload.decision,
        rationale=payload.rationale,
        alternatives=payload.alternatives,
        position_snapshot=snapshot,
        review_at=payload.review_at,
    )
    database.add(decision)
    topic.status = "DECIDED"
    database.flush()
    database.add_all(
        [
            AuditEvent(
                workspace_id=principal.workspace_id,
                actor_id=principal.user_id,
                action="ALIGNMENT_DECISION_PUBLISHED",
                resource_type="DECISION_RECORD",
                resource_id=decision.id,
            ),
            AuditEvent(
                workspace_id=principal.workspace_id,
                actor_id=principal.user_id,
                action="MEMORY_SHARED",
                resource_type="MEMORY",
                resource_id=memory.id,
            ),
        ]
    )
    return decision
