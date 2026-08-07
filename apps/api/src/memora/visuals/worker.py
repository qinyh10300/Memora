from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

import structlog
from pydantic import ValidationError
from sqlalchemy import Engine, Select, and_, or_, select
from sqlalchemy.orm import Session

from memora.ai.openai_compatible import build_chat_model, build_image_generator
from memora.ai.ports import (
    AIProviderError,
    ChatMessage,
    ChatModelPort,
    ImageGenerationPort,
    ImageGenerationRequest,
)
from memora.assets.service import AssetValidationError, create_asset
from memora.audit.models import AuditEvent
from memora.billing.service import release_credit_reservation, settle_credit_reservation
from memora.diagrams.schemas import DiagramWriteRequest
from memora.diagrams.service import DiagramReferenceError, validate_and_serialize_graph
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.settings import Settings
from memora.visuals.models import (
    VisualGenerationJob,
    VisualProject,
    VisualSource,
    VisualVersion,
)
from memora.visuals.service import next_visual_version_number
from memora.workspaces.models import WorkspaceMembership

RUNNING_LEASE_SECONDS = 600
MAX_RETRY_DELAY_SECONDS = 3600
MAX_SOURCE_PROMPT_CHARS = 20_000


@dataclass(frozen=True)
class VisualSourceContext:
    memory_id: UUID
    title: str | None
    body: str
    author_name: str
    created_at: datetime


@dataclass(frozen=True)
class ClaimedVisualJob:
    job_id: UUID
    project_id: UUID
    reservation_id: UUID
    workspace_id: UUID
    user_id: UUID
    user_email: str
    user_display_name: str
    user_role: str
    mode: str
    kind: str
    visibility: str
    model_id: str
    provider_model: str
    request_payload: dict[str, Any]
    attempts: int
    sources: tuple[VisualSourceContext, ...]

    def principal(self) -> Principal:
        return Principal(
            user_id=self.user_id,
            workspace_id=self.workspace_id,
            email=self.user_email,
            display_name=self.user_display_name,
            role=self.user_role,
        )


def _eligible_visual_job_statement(now: datetime) -> Select[tuple[VisualGenerationJob]]:
    stale_before = now - timedelta(seconds=RUNNING_LEASE_SECONDS)
    return (
        select(VisualGenerationJob)
        .where(
            or_(
                and_(
                    VisualGenerationJob.status.in_(("QUEUED", "FAILED")),
                    VisualGenerationJob.next_run_at.is_not(None),
                    VisualGenerationJob.next_run_at <= now,
                ),
                and_(
                    VisualGenerationJob.status == "RUNNING",
                    VisualGenerationJob.locked_at.is_not(None),
                    VisualGenerationJob.locked_at < stale_before,
                ),
            )
        )
        .order_by(
            VisualGenerationJob.next_run_at,
            VisualGenerationJob.created_at,
            VisualGenerationJob.id,
        )
        .limit(1)
        .with_for_update(skip_locked=True)
    )


def _cancel_invalid_claim(
    database: Session,
    job: VisualGenerationJob,
    project: VisualProject | None,
    *,
    error_code: str,
    now: datetime,
) -> None:
    job.status = "CANCELLED"
    job.stage = "CANCELLED"
    job.progress = 100
    job.error_code = error_code
    job.next_run_at = None
    job.locked_at = None
    job.completed_at = now
    if project is not None:
        project.status = "CANCELLED"
    release_credit_reservation(database, job.reservation_id)


def claim_next_visual_job(
    engine: Engine,
    now: datetime,
) -> ClaimedVisualJob | None:
    with Session(engine) as database, database.begin():
        job = database.scalar(_eligible_visual_job_statement(now))
        if job is None:
            return None
        project = database.get(VisualProject, job.project_id)
        user = database.get(User, job.requested_by_user_id)
        membership = database.get(
            WorkspaceMembership,
            (job.workspace_id, job.requested_by_user_id),
        )
        if (
            project is None
            or user is None
            or user.status != "ACTIVE"
            or membership is None
            or project.owner_id != job.requested_by_user_id
        ):
            _cancel_invalid_claim(
                database,
                job,
                project,
                error_code="visual_owner_unavailable",
                now=now,
            )
            return None

        principal = Principal(
            user_id=user.id,
            workspace_id=job.workspace_id,
            email=user.email,
            display_name=user.display_name,
            role=membership.role,
        )
        source_ids = set(
            database.scalars(
                select(VisualSource.memory_id).where(VisualSource.job_id == job.id)
            ).all()
        )
        authorized_rows = (
            database.execute(
                authorized_memories_statement(principal).where(Memory.id.in_(source_ids))
            )
            .tuples()
            .all()
            if source_ids
            else []
        )
        if {memory.id for memory, _author, _projection in authorized_rows} != source_ids or (
            project.visibility == "WORKSPACE"
            and any(memory.visibility != "WORKSPACE" for memory, _author, _ in authorized_rows)
        ):
            _cancel_invalid_claim(
                database,
                job,
                project,
                error_code="visual_source_unavailable",
                now=now,
            )
            return None

        job.status = "RUNNING"
        job.stage = "AUTHORIZING_SOURCES"
        job.progress = 10
        job.attempts += 1
        job.locked_at = now
        job.started_at = job.started_at or now
        job.next_run_at = None
        job.error_code = None
        project.status = "GENERATING"
        sources = tuple(
            VisualSourceContext(
                memory_id=memory.id,
                title=memory.title,
                body=memory.body or "",
                author_name=author.display_name,
                created_at=memory.created_at,
            )
            for memory, author, _projection in authorized_rows
        )
        return ClaimedVisualJob(
            job_id=job.id,
            project_id=project.id,
            reservation_id=job.reservation_id,
            workspace_id=job.workspace_id,
            user_id=user.id,
            user_email=user.email,
            user_display_name=user.display_name,
            user_role=membership.role,
            mode=job.mode,
            kind=project.kind,
            visibility=project.visibility,
            model_id=job.model_id,
            provider_model=job.provider_model,
            request_payload=job.request_payload,
            attempts=job.attempts,
            sources=sources,
        )


def _source_payload(sources: tuple[VisualSourceContext, ...]) -> list[dict[str, str]]:
    remaining = MAX_SOURCE_PROMPT_CHARS
    payload: list[dict[str, str]] = []
    for source in sources:
        body = source.body[:remaining]
        remaining -= len(body)
        payload.append(
            {
                "memory_id": str(source.memory_id),
                "title": source.title or "未命名记忆",
                "author": source.author_name,
                "created_at": source.created_at.isoformat(),
                "body": body,
            }
        )
        if remaining <= 0:
            break
    return payload


def _structured_messages(claimed: ClaimedVisualJob) -> list[ChatMessage]:
    request_prompt = str(claimed.request_payload.get("prompt", "")).strip()
    input_payload = {
        "request": request_prompt,
        "kind": claimed.kind,
        "allowed_memory_ids": [str(source.memory_id) for source in claimed.sources],
        "sources": _source_payload(claimed.sources),
    }
    return [
        ChatMessage(
            role="system",
            content=(
                "Generate an editable evidence-grounded graph. Return one JSON object with "
                "title, nodes and edges. Node fields are id, kind, position, and exactly one of "
                "memory_id or text. kind must be MEMORY or NOTE. MEMORY nodes may only use IDs in "
                "allowed_memory_ids. NOTE nodes must be concise and cannot invent factual claims. "
                "Edge fields are id, source, target and optional label. Use unique safe ASCII IDs."
            ),
        ),
        ChatMessage(role="user", content=json.dumps(input_payload, ensure_ascii=False)),
    ]


def _parse_structured_graph(
    claimed: ClaimedVisualJob,
    raw_content: str,
) -> DiagramWriteRequest:
    normalized = raw_content.strip()
    if normalized.startswith("```") and normalized.endswith("```"):
        normalized = normalized.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        decoded = json.loads(normalized)
    except json.JSONDecodeError as error:
        raise AIProviderError("invalid_graph_response", retryable=True) from error
    if not isinstance(decoded, dict):
        raise AIProviderError("invalid_graph_response", retryable=True)
    allowed_memory_ids = {source.memory_id for source in claimed.sources}
    try:
        graph = DiagramWriteRequest.model_validate(
            {
                "title": decoded.get("title") or claimed.request_payload.get("prompt") or "AI 框图",
                "kind": claimed.kind,
                "visibility": claimed.visibility,
                "nodes": decoded.get("nodes"),
                "edges": decoded.get("edges"),
            }
        )
    except ValidationError as error:
        raise AIProviderError("invalid_graph_response", retryable=True) from error
    if not graph.nodes or any(node.kind == "PERSON" for node in graph.nodes):
        raise AIProviderError("invalid_graph_response", retryable=True)
    generated_memory_ids = {node.memory_id for node in graph.nodes if node.memory_id is not None}
    if not generated_memory_ids.issubset(allowed_memory_ids):
        raise AIProviderError("invalid_graph_source", retryable=False)
    return graph


def _image_prompt(claimed: ClaimedVisualJob) -> str:
    base_prompt = str(claimed.request_payload.get("prompt", "")).strip()
    instructions = [base_prompt]
    if bool(claimed.request_payload.get("scientific_style", True)):
        instructions.append(
            "Use a precise scientific visual language, clear hierarchy, restrained color, and "
            "publication-ready composition. Do not fabricate measurements or labels."
        )
    if claimed.request_payload.get("watermark_mode") == "CLEAN_OUTPUT":
        instructions.append("Do not add a watermark, signature, brand mark, or logo.")
    output_language = str(claimed.request_payload.get("output_language", "auto"))
    if output_language.casefold() != "auto":
        instructions.append(f"Use {output_language} for any necessary labels.")
    if claimed.sources:
        instructions.append(
            "Use only the following authorized source material as factual context:\n"
            + json.dumps(_source_payload(claimed.sources), ensure_ascii=False)
        )
    return "\n\n".join(instructions)


def _reauthorize_sources(
    database: Session,
    claimed: ClaimedVisualJob,
    project: VisualProject,
) -> bool:
    source_ids = {source.memory_id for source in claimed.sources}
    if not source_ids:
        return True
    rows = (
        database.execute(
            authorized_memories_statement(claimed.principal()).where(Memory.id.in_(source_ids))
        )
        .tuples()
        .all()
    )
    if {memory.id for memory, _author, _projection in rows} != source_ids:
        return False
    return project.visibility != "WORKSPACE" or all(
        memory.visibility == "WORKSPACE" for memory, _author, _projection in rows
    )


def complete_structured_visual_job(
    engine: Engine,
    claimed: ClaimedVisualJob,
    graph: DiagramWriteRequest,
    model: str,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(VisualGenerationJob, claimed.job_id)
        project = database.get(VisualProject, claimed.project_id)
        if job is None or project is None or job.status == "CANCELLED":
            return
        if not _reauthorize_sources(database, claimed, project):
            raise AIProviderError("visual_source_unavailable", retryable=False)
        try:
            nodes, edges = validate_and_serialize_graph(
                database,
                claimed.principal(),
                graph.nodes,
                graph.edges,
                graph.visibility,
            )
        except DiagramReferenceError as error:
            raise AIProviderError("visual_source_unavailable", retryable=False) from error
        version = VisualVersion(
            project_id=project.id,
            job_id=job.id,
            version_number=next_visual_version_number(database, project.id),
            status="CANDIDATE",
            model_id=claimed.model_id,
            provider_model=model,
            prompt=str(claimed.request_payload.get("prompt", "")),
            graph={
                "title": graph.title,
                "kind": graph.kind,
                "nodes": nodes,
                "edges": edges,
            },
        )
        database.add(version)
        database.flush()
        for source in database.scalars(
            select(VisualSource).where(VisualSource.job_id == job.id)
        ).all():
            source.version_id = version.id
        settle_credit_reservation(database, job.reservation_id, now=now)
        job.status = "WAITING_CONFIRMATION"
        job.stage = "WAITING_CONFIRMATION"
        job.progress = 100
        job.locked_at = None
        job.next_run_at = None
        job.completed_at = now
        project.status = "WAITING_CONFIRMATION"
        database.add(
            AuditEvent(
                workspace_id=job.workspace_id,
                actor_id=job.requested_by_user_id,
                action="VISUAL_STRUCTURE_GENERATED",
                resource_type="VISUAL_VERSION",
                resource_id=version.id,
                model=model,
            )
        )


def complete_image_visual_job(
    engine: Engine,
    claimed: ClaimedVisualJob,
    result: Any,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(VisualGenerationJob, claimed.job_id)
        project = database.get(VisualProject, claimed.project_id)
        if job is None or project is None or job.status == "CANCELLED":
            return
        if not _reauthorize_sources(database, claimed, project):
            raise AIProviderError("visual_source_unavailable", retryable=False)
        version_number = next_visual_version_number(database, project.id)
        for index, image in enumerate(result.images, start=1):
            extension = image.media_type.split("/")[-1]
            try:
                asset = create_asset(
                    database,
                    claimed.principal(),
                    name=f"{project.title}-{version_number + index - 1}.{extension}",
                    media_type=image.media_type,
                    content=image.content,
                )
            except AssetValidationError as error:
                raise AIProviderError("invalid_generated_image", retryable=True) from error
            database.flush()
            database.add(
                VisualVersion(
                    project_id=project.id,
                    job_id=job.id,
                    version_number=version_number + index - 1,
                    status="CONFIRMED",
                    model_id=claimed.model_id,
                    provider_model=result.model,
                    prompt=str(claimed.request_payload.get("prompt", "")),
                    revised_prompt=result.revised_prompt,
                    asset_id=asset.id,
                )
            )
        settle_credit_reservation(database, job.reservation_id, now=now)
        job.status = "COMPLETED"
        job.stage = "SAVED"
        job.progress = 100
        job.locked_at = None
        job.next_run_at = None
        job.completed_at = now
        project.status = "COMPLETED"
        database.add(
            AuditEvent(
                workspace_id=job.workspace_id,
                actor_id=job.requested_by_user_id,
                action="VISUAL_IMAGE_GENERATED",
                resource_type="VISUAL_JOB",
                resource_id=job.id,
                model=result.model,
                input_tokens=result.usage.input_tokens,
                output_tokens=result.usage.output_tokens,
            )
        )


def fail_visual_job(
    engine: Engine,
    claimed: ClaimedVisualJob,
    error: AIProviderError,
    settings: Settings,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(VisualGenerationJob, claimed.job_id)
        project = database.get(VisualProject, claimed.project_id)
        if job is None or job.status == "CANCELLED":
            return
        job.status = "FAILED"
        job.stage = "FAILED"
        job.locked_at = None
        job.error_code = error.code
        if error.retryable and claimed.attempts < settings.ai_image_max_attempts:
            delay = min(
                settings.ai_job_retry_base_seconds * (2 ** (claimed.attempts - 1)),
                MAX_RETRY_DELAY_SECONDS,
            )
            job.next_run_at = now + timedelta(seconds=delay)
            job.progress = 20
        else:
            job.next_run_at = None
            job.completed_at = now
            job.progress = 100
            release_credit_reservation(database, job.reservation_id, now=now)
        if project is not None:
            project.status = "FAILED"


def process_next_visual_job(
    engine: Engine,
    settings: Settings,
    *,
    now: datetime | None = None,
    chat_model: ChatModelPort | None = None,
    image_generator: ImageGenerationPort | None = None,
) -> bool:
    current_time = now or datetime.now(UTC)
    claimed = claim_next_visual_job(engine, current_time)
    if claimed is None:
        return False
    logger = structlog.get_logger("memora.worker.visual")
    try:
        if claimed.mode == "STRUCTURED":
            resolved_chat = chat_model or build_chat_model(
                settings,
                model=claimed.provider_model,
            )
            if resolved_chat is None:
                raise AIProviderError("visual_model_not_configured", retryable=False)
            chat_result = resolved_chat.complete(_structured_messages(claimed))
            graph = _parse_structured_graph(claimed, chat_result.content)
            complete_structured_visual_job(
                engine,
                claimed,
                graph,
                chat_result.model,
                current_time,
            )
        else:
            resolved_image = image_generator or build_image_generator(
                settings,
                model=claimed.provider_model,
            )
            if resolved_image is None:
                raise AIProviderError("visual_model_not_configured", retryable=False)
            request = ImageGenerationRequest(
                prompt=_image_prompt(claimed),
                model_id=claimed.provider_model,
                aspect_ratio=cast(Any, claimed.request_payload.get("aspect_ratio", "1:1")),
                count=int(claimed.request_payload.get("count", 1)),
                quality=cast(Any, claimed.request_payload.get("quality", "standard")),
                scientific_style=bool(claimed.request_payload.get("scientific_style", True)),
                watermark_mode=cast(
                    Any,
                    claimed.request_payload.get("watermark_mode", "CLEAN_OUTPUT"),
                ),
                output_language=str(claimed.request_payload.get("output_language", "auto")),
            )
            image_result = resolved_image.generate(request)
            complete_image_visual_job(engine, claimed, image_result, current_time)
    except AIProviderError as error:
        fail_visual_job(engine, claimed, error, settings, current_time)
        logger.warning(
            "visual.failed",
            job_id=str(claimed.job_id),
            mode=claimed.mode,
            model=claimed.provider_model,
            error_code=error.code,
            retryable=error.retryable,
            attempt=claimed.attempts,
        )
        return True
    logger.info(
        "visual.completed",
        job_id=str(claimed.job_id),
        mode=claimed.mode,
        model=claimed.provider_model,
        attempt=claimed.attempts,
    )
    return True
