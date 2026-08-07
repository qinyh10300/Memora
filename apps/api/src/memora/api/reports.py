from collections import Counter
from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from memora.ai.openai_compatible import build_chat_model
from memora.ai.ports import AIProviderError, ChatResult
from memora.audit.models import AuditEvent
from memora.billing.service import InsufficientCreditsError, consume_credits
from memora.conversations.service import excerpt_for
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User
from memora.identity.rate_limit import LoginRateLimiter
from memora.memories.models import Memory
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.memories.service import add_private_memory_with_processing
from memora.reports.models import GeneratedReport, ReportSource
from memora.reports.service import (
    ReportEvidence,
    ReportSectionKind,
    accessible_reports_statement,
    authorized_report_evidence,
    build_report_sections,
    complete_report_summary,
    deterministic_summary,
    get_accessible_report,
    select_report_evidence,
)
from memora.retrieval.schemas import EvidenceCitationResponse, evidence_citation_for
from memora.settings import Settings, get_settings
from memora.visuals.schemas import CreateVisualProjectRequest, VisualProjectResponse
from memora.visuals.service import create_visual_project, task_credit_costs, visual_project_response
from memora.workspaces.models import WorkspaceMembership

router = APIRouter(prefix="/reports", tags=["reports"])
ReportScope = Literal["PERSONAL", "COLLEAGUE", "MEMBER", "WORKSPACE", "PROJECT"]
ReportStatus = Literal["GENERATED", "NO_EVIDENCE"]
ModelStatus = Literal["AVAILABLE", "DISABLED", "DEGRADED"]
ReportVisibility = Literal["PRIVATE", "WORKSPACE"]


class ReportRequest(BaseModel):
    scope: ReportScope
    author_id: UUID | None = None
    topic: str = Field(min_length=1, max_length=500)
    created_from: datetime
    created_to: datetime
    evidence_limit: int = Field(default=20, ge=1, le=30)
    visibility: ReportVisibility = "PRIVATE"

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
    visibility: ReportVisibility
    is_owner: bool
    sources_available: bool
    saved_memory_id: UUID | None
    created_at: datetime


class SaveReportMemoryRequest(BaseModel):
    visibility: ReportVisibility = "PRIVATE"


class CreateVisualFromReportRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Literal["MIND_MAP", "FLOWCHART", "TIMELINE"] = "MIND_MAP"
    visibility: ReportVisibility = "PRIVATE"


class CreateVisualFromReportResponse(BaseModel):
    project: VisualProjectResponse
    memory_ids: list[UUID]


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
    if payload.scope not in {"COLLEAGUE", "MEMBER"}:
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
    elif payload.scope in {"COLLEAGUE", "MEMBER"} and member is not None:
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


def _stored_scope(scope: ReportScope) -> str:
    return "MEMBER" if scope == "COLLEAGUE" else scope


def _report_response(
    report: GeneratedReport,
    principal: CurrentPrincipal,
    evidence: list[ReportEvidence],
) -> ReportResponse:
    return ReportResponse(
        report_id=report.id,
        status=cast(ReportStatus, report.status),
        model_status=cast(ModelStatus, report.model_status),
        scope=cast(ReportScope, report.scope),
        topic=report.topic,
        created_from=report.created_from,
        created_to=report.created_to,
        title=report.title,
        summary=report.summary,
        contributors=[ContributorResponse.model_validate(item) for item in report.contributors],
        sections=[ReportSectionResponse.model_validate(item) for item in report.sections],
        citations=[
            evidence_citation_for(
                item.memory,
                item.author,
                excerpt=excerpt_for(item.memory.body or ""),
            )
            for item in evidence
        ],
        visibility=cast(ReportVisibility, report.visibility),
        is_owner=report.created_by_user_id == principal.user_id,
        sources_available=True,
        saved_memory_id=report.saved_memory_id,
        created_at=report.created_at,
    )


def _accessible_report_or_404(
    database: DatabaseSession,
    principal: CurrentPrincipal,
    report_id: UUID,
) -> tuple[GeneratedReport, list[ReportEvidence]]:
    report = get_accessible_report(database, principal, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")
    sources_available, evidence = authorized_report_evidence(database, principal, report)
    if not sources_available:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告来源已不可用")
    return report, evidence


@router.get("", response_model=list[ReportResponse])
def list_reports(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[ReportResponse]:
    reports = database.scalars(
        accessible_reports_statement(principal).order_by(
            GeneratedReport.created_at.desc(),
            GeneratedReport.id.desc(),
        )
    ).all()
    result: list[ReportResponse] = []
    for report in reports:
        sources_available, evidence = authorized_report_evidence(database, principal, report)
        if sources_available:
            result.append(_report_response(report, principal, evidence))
    return result


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
    if payload.visibility == "WORKSPACE" and any(
        item.memory.visibility != "WORKSPACE" for item in authorized_evidence
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="共享报告只能引用已共享到当前空间的记忆",
        )
    contributor_rows = _contributors(authorized_evidence)
    section_rows = [
        ReportSectionResponse(
            kind=section.kind,
            title=section.title,
            content=section.content,
            citation_memory_ids=list(section.memory_ids),
        )
        for section in sections
    ]
    report = GeneratedReport(
        id=report_id,
        workspace_id=principal.workspace_id,
        created_by_user_id=principal.user_id,
        subject_author_id=subject_author_id,
        scope=_stored_scope(payload.scope),
        status="GENERATED" if authorized_evidence else "NO_EVIDENCE",
        model_status=model_status,
        visibility=payload.visibility,
        topic=payload.topic,
        title=_title_for(payload, member),
        summary=summary,
        sections=[section.model_dump(mode="json") for section in section_rows],
        contributors=[contributor.model_dump(mode="json") for contributor in contributor_rows],
        created_from=payload.created_from,
        created_to=payload.created_to,
    )
    database.add(report)
    database.flush()
    for item in authorized_evidence:
        database.add(
            ReportSource(
                report_id=report.id,
                memory_id=item.memory.id,
                author_id_at_generation=item.author.id,
                memory_created_at=item.memory.created_at,
            )
        )
    try:
        consume_credits(
            database,
            principal.user_id,
            task_credit_costs(settings)["report"],
            idempotency_key=f"report:{report.id}",
            reference_type="REPORT",
            reference_id=str(report.id),
        )
    except InsufficientCreditsError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="credits 余额不足，请升级套餐后继续",
        ) from error
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
    database.refresh(report)
    return _report_response(report, principal, authorized_evidence)


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ReportResponse:
    report, evidence = _accessible_report_or_404(database, principal, report_id)
    return _report_response(report, principal, evidence)


def _report_markdown(report: GeneratedReport, evidence: list[ReportEvidence]) -> str:
    lines = [f"# {report.title}", "", report.summary]
    for raw_section in report.sections:
        section = ReportSectionResponse.model_validate(raw_section)
        lines.extend(["", f"## {section.title}", "", section.content])
    if evidence:
        lines.extend(["", "## 来源", ""])
        lines.extend(
            f"- {item.author.display_name} · {item.memory.created_at.isoformat()} · "
            f"记忆 `{item.memory.id}`"
            for item in evidence
        )
    return "\n".join(lines)[:10_000]


@router.post("/{report_id}/save-memory", response_model=MemoryResponse)
def save_report_as_memory(
    report_id: UUID,
    payload: SaveReportMemoryRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    report, evidence = _accessible_report_or_404(database, principal, report_id)
    if report.created_by_user_id != principal.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有报告创建者可以保存")
    if payload.visibility == "WORKSPACE" and any(
        item.memory.visibility != "WORKSPACE" for item in evidence
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="共享记忆只能引用已共享到当前空间的来源",
        )
    existing = database.get(Memory, report.saved_memory_id) if report.saved_memory_id else None
    if existing is not None and existing.deleted_at is None:
        author = database.get(User, existing.author_id)
        if author is None:
            raise RuntimeError("report memory author disappeared")
        return memory_response_for(existing, author, None, principal, [])

    memory_id = uuid4()
    memory, projection = add_private_memory_with_processing(
        database,
        principal,
        memory_id=memory_id,
        body=_report_markdown(report, evidence),
        supersedes_id=None,
        timeline_entry_id=memory_id,
        revision_kind="ROOT",
    )
    if payload.visibility == "WORKSPACE":
        memory.visibility = "WORKSPACE"
        memory.shared_at = datetime.now(UTC)
    report.saved_memory_id = memory.id
    database.add_all(
        [
            AuditEvent(
                workspace_id=principal.workspace_id,
                actor_id=principal.user_id,
                action="REPORT_SAVED_AS_MEMORY",
                resource_type="REPORT",
                resource_id=report.id,
            ),
            AuditEvent(
                workspace_id=principal.workspace_id,
                actor_id=principal.user_id,
                action="MEMORY_CREATED",
                resource_type="MEMORY",
                resource_id=memory.id,
            ),
        ]
    )
    database.commit()
    database.refresh(memory)
    author = database.get(User, principal.user_id)
    if author is None:
        raise RuntimeError("authenticated user disappeared")
    return memory_response_for(memory, author, projection, principal, [])


@router.post(
    "/{report_id}/create-visual",
    response_model=CreateVisualFromReportResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_visual_from_report(
    report_id: UUID,
    payload: CreateVisualFromReportRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> CreateVisualFromReportResponse:
    report, evidence = _accessible_report_or_404(database, principal, report_id)
    if payload.visibility == "WORKSPACE" and any(
        item.memory.visibility != "WORKSPACE" for item in evidence
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="团队可见框图只能引用团队已共享来源",
        )
    project = create_visual_project(
        database,
        principal,
        CreateVisualProjectRequest(
            title=payload.title or report.title[:120],
            mode="STRUCTURED",
            kind=payload.kind,
            visibility=payload.visibility,
        ),
    )
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="VISUAL_CREATED_FROM_REPORT",
            resource_type="VISUAL_PROJECT",
            resource_id=project.id,
        )
    )
    database.commit()
    database.refresh(project)
    return CreateVisualFromReportResponse(
        project=visual_project_response(database, principal, project),
        memory_ids=[item.memory.id for item in evidence],
    )
