from collections import Counter
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from memora.ai.openai_compatible import build_chat_model
from memora.ai.ports import AIProviderError, ChatResult
from memora.audit.models import AuditEvent
from memora.conversations.service import excerpt_for
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User
from memora.identity.rate_limit import LoginRateLimiter
from memora.reports.service import (
    ReportEvidence,
    ReportSectionKind,
    build_report_sections,
    complete_report_summary,
    deterministic_summary,
    select_report_evidence,
)
from memora.retrieval.schemas import EvidenceCitationResponse, evidence_citation_for
from memora.settings import Settings, get_settings
from memora.workspaces.models import WorkspaceMembership

router = APIRouter(prefix="/reports", tags=["reports"])
ReportScope = Literal["PERSONAL", "COLLEAGUE", "WORKSPACE"]
ReportStatus = Literal["GENERATED", "NO_EVIDENCE"]
ModelStatus = Literal["AVAILABLE", "DISABLED", "DEGRADED"]


class ReportRequest(BaseModel):
    scope: ReportScope
    author_id: UUID | None = None
    topic: str = Field(min_length=1, max_length=500)
    created_from: datetime
    created_to: datetime
    evidence_limit: int = Field(default=20, ge=1, le=30)

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("报告主题不能为空")
        return normalized


class ReportSectionResponse(BaseModel):
    kind: ReportSectionKind
    title: str
    content: str
    citation_memory_ids: list[UUID]


class ContributorResponse(BaseModel):
    author_id: UUID
    display_name: str
    record_count: int


class ReportResponse(BaseModel):
    report_id: UUID
    status: ReportStatus
    model_status: ModelStatus
    scope: ReportScope
    topic: str
    created_from: datetime
    created_to: datetime
    title: str
    summary: str
    contributors: list[ContributorResponse]
    sections: list[ReportSectionResponse]
    citations: list[EvidenceCitationResponse]


def _validate_time_range(payload: ReportRequest) -> None:
    if payload.created_from.tzinfo is None or payload.created_to.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="报告时间范围必须包含时区",
        )
    if payload.created_from >= payload.created_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="开始时间必须早于结束时间",
        )


def _validate_scope(
    payload: ReportRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> User | None:
    if payload.scope != "COLLEAGUE":
        if payload.author_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="只有同事报告可以指定成员",
            )
        return None
    if payload.author_id is None or payload.author_id == principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="请选择另一位工作区成员",
        )
    member = database.scalar(
        select(User)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(
            User.id == payload.author_id,
            WorkspaceMembership.workspace_id == principal.workspace_id,
            User.status == "ACTIVE",
        )
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在")
    return member


def _title_for(payload: ReportRequest, member: User | None) -> str:
    if payload.scope == "PERSONAL":
        prefix = "我的"
    elif payload.scope == "COLLEAGUE" and member is not None:
        prefix = f"{member.display_name} 的共享"
    else:
        prefix = "团队共享"
    return f"{prefix}想法报告 · {payload.topic}"


def _contributors(evidence: list[ReportEvidence]) -> list[ContributorResponse]:
    counts = Counter(item.author.id for item in evidence)
    authors = {item.author.id: item.author.display_name for item in evidence}
    return [
        ContributorResponse(
            author_id=author_id,
            display_name=authors[author_id],
            record_count=count,
        )
        for author_id, count in sorted(counts.items(), key=lambda item: authors[item[0]])
    ]


@router.post("", response_model=ReportResponse)
def generate_report(
    payload: ReportRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReportResponse:
    limiter: LoginRateLimiter = request.app.state.ai_rate_limiter
    if not limiter.consume(str(principal.user_id)):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
    _validate_time_range(payload)
    member = _validate_scope(payload, principal, database)
    subject_author_id = member.id if member is not None else None
    evidence = select_report_evidence(
        database,
        principal,
        scope=payload.scope,
        subject_author_id=subject_author_id,
        topic=payload.topic,
        created_from=payload.created_from,
        created_to=payload.created_to,
        limit=payload.evidence_limit,
    )
    database.commit()

    chat_model = build_chat_model(settings)
    model_status: ModelStatus = "DISABLED"
    model_result: ChatResult | None = None
    if evidence and chat_model is not None:
        try:
            model_result = complete_report_summary(
                chat_model,
                scope=payload.scope,
                topic=payload.topic,
                created_from=payload.created_from,
                created_to=payload.created_to,
                evidence=evidence,
            )
            model_status = "AVAILABLE"
        except AIProviderError:
            model_status = "DEGRADED"

    current_evidence = select_report_evidence(
        database,
        principal,
        scope=payload.scope,
        subject_author_id=subject_author_id,
        topic=payload.topic,
        created_from=payload.created_from,
        created_to=payload.created_to,
        limit=payload.evidence_limit,
    )
    current_by_id = {item.memory.id: item for item in current_evidence}
    authorized_evidence = [
        current_by_id[item.memory.id] for item in evidence if item.memory.id in current_by_id
    ]
    if len(authorized_evidence) != len(evidence):
        model_result = None
        model_status = "DEGRADED" if chat_model is not None else "DISABLED"

    summary = (
        model_result.content
        if model_result is not None
        else deterministic_summary(
            authorized_evidence,
            topic=payload.topic,
            created_from=payload.created_from,
            created_to=payload.created_to,
        )
    )
    sections = build_report_sections(
        authorized_evidence,
        topic=payload.topic,
        created_from=payload.created_from,
        created_to=payload.created_to,
    )
    report_id = uuid4()
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="REPORT_GENERATED",
            resource_type="REPORT",
            resource_id=report_id,
        )
    )
    database.commit()
    return ReportResponse(
        report_id=report_id,
        status="GENERATED" if authorized_evidence else "NO_EVIDENCE",
        model_status=model_status,
        scope=payload.scope,
        topic=payload.topic,
        created_from=payload.created_from,
        created_to=payload.created_to,
        title=_title_for(payload, member),
        summary=summary,
        contributors=_contributors(authorized_evidence),
        sections=[
            ReportSectionResponse(
                kind=section.kind,
                title=section.title,
                content=section.content,
                citation_memory_ids=list(section.memory_ids),
            )
            for section in sections
        ],
        citations=[
            evidence_citation_for(
                item.memory,
                item.author,
                excerpt=excerpt_for(item.memory.body or ""),
            )
            for item in authorized_evidence
        ],
    )
