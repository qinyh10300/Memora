from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from memora.assets.service import cleanup_unreferenced_assets_for_deleted_markdown
from memora.audit.models import AuditEvent
from memora.conversations.models import Conversation, Message
from memora.conversations.service import (
    conversation_title_for,
    get_owned_conversation,
    invalidate_cited_answers,
    persist_capture,
)
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal, Principal
from memora.identity.models import User
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.memories.service import (
    add_private_memory_with_processing,
    get_authorized_memory,
    get_memory_for_author_action,
    list_authorized_memories,
    list_owned_memory_revisions,
)
from memora.retrieval.models import MemoryEmbedding
from memora.workspaces.models import Workspace

router = APIRouter(prefix="/memories", tags=["memories"])
MemoryVisibility = Literal["PRIVATE", "WORKSPACE"]
MemoryRevisionMode = Literal["UPDATE_CURRENT", "NEW_VERSION"]


class CreateMemoryRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)
    visibility: MemoryVisibility = "PRIVATE"
    supersedes_id: UUID | None = None
    conversation_id: UUID | None = None

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("想法正文不能为空")
        return normalized


class CreateMemoryRevisionRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)
    mode: MemoryRevisionMode

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("想法正文不能为空")
        return normalized


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")


def _author_row_or_error(
    database: DatabaseSession, principal: Principal, memory_id: UUID
) -> tuple[Memory, User, MemoryEmbedding | None]:
    row = get_memory_for_author_action(database, principal, memory_id)
    if row is None:
        raise _not_found()
    memory, author, projection = row
    if memory.author_id != principal.user_id:
        if memory.visibility == "PRIVATE":
            raise _not_found()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有作者可以执行此操作")
    return memory, author, projection


def _audit(database: DatabaseSession, principal: Principal, action: str, memory_id: UUID) -> None:
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action=action,
            resource_type="MEMORY",
            resource_id=memory_id,
        )
    )


def _require_team_workspace(database: DatabaseSession, principal: Principal) -> None:
    workspace_kind = database.scalar(
        select(Workspace.kind).where(Workspace.id == principal.workspace_id)
    )
    if workspace_kind != "TEAM":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="个人空间不能共享给团队",
        )


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def create_memory(
    payload: CreateMemoryRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    if payload.visibility == "WORKSPACE":
        _require_team_workspace(database, principal)

    conversation = (
        get_owned_conversation(database, principal, payload.conversation_id)
        if payload.conversation_id is not None
        else None
    )
    if payload.conversation_id is not None and conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")

    if payload.supersedes_id is not None:
        superseded_memory = database.scalar(
            select(Memory).where(
                Memory.id == payload.supersedes_id,
                Memory.workspace_id == principal.workspace_id,
                Memory.author_id == principal.user_id,
                Memory.deleted_at.is_(None),
            )
        )
        if superseded_memory is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="只能补充自己仍然存在的记录",
            )

    memory_id = uuid4()
    memory, projection = add_private_memory_with_processing(
        database,
        principal,
        memory_id=memory_id,
        body=payload.body,
        supersedes_id=payload.supersedes_id,
        timeline_entry_id=memory_id,
        revision_kind="NEW_VERSION" if payload.supersedes_id is not None else "ROOT",
    )
    if payload.visibility == "WORKSPACE":
        memory.visibility = "WORKSPACE"
        memory.shared_at = datetime.now(UTC)
    _audit(database, principal, "MEMORY_CREATED", memory.id)
    if payload.visibility == "WORKSPACE":
        _audit(database, principal, "MEMORY_SHARED", memory.id)
    if conversation is not None:
        persist_capture(
            database,
            conversation=conversation,
            memory=memory,
            body=payload.body,
        )
    database.commit()
    database.refresh(memory)
    author = database.get(User, principal.user_id)
    if author is None:
        raise RuntimeError("authenticated user disappeared")
    return memory_response_for(memory, author, projection, principal)


@router.post(
    "/{memory_id}/revisions",
    response_model=MemoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_memory_revision(
    memory_id: UUID,
    payload: CreateMemoryRevisionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    source, author, _projection = _author_row_or_error(database, principal, memory_id)
    locked_source = database.scalar(
        select(Memory)
        .where(
            Memory.id == source.id,
            Memory.workspace_id == principal.workspace_id,
            Memory.author_id == principal.user_id,
            Memory.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if locked_source is None:
        raise _not_found()
    if not locked_source.timeline_visible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这条记忆已有更新，请刷新后重试",
        )
    if payload.body == locked_source.body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="内容没有变化",
        )

    new_memory_id = uuid4()
    if payload.mode == "UPDATE_CURRENT":
        invalidate_cited_answers(
            database,
            memory_id=locked_source.id,
            author_id=locked_source.author_id,
            include_author=True,
        )
        locked_source.timeline_visible = False
        timeline_entry_id = locked_source.timeline_entry_id
        audit_action = "MEMORY_CURRENT_UPDATED"
    else:
        timeline_entry_id = new_memory_id
        audit_action = "MEMORY_VERSION_CREATED"

    memory, projection = add_private_memory_with_processing(
        database,
        principal,
        memory_id=new_memory_id,
        body=payload.body,
        supersedes_id=locked_source.id,
        timeline_entry_id=timeline_entry_id,
        revision_kind=payload.mode,
    )
    if payload.mode == "UPDATE_CURRENT" and locked_source.visibility == "WORKSPACE":
        memory.visibility = "WORKSPACE"
        memory.shared_at = locked_source.shared_at or datetime.now(UTC)
    _audit(database, principal, audit_action, memory.id)
    database.commit()
    database.refresh(memory)
    return memory_response_for(memory, author, projection, principal)


@router.get("/{memory_id}/revisions", response_model=list[MemoryResponse])
def list_memory_revisions(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[MemoryResponse]:
    memory, _author, _projection = _author_row_or_error(database, principal, memory_id)
    rows = list_owned_memory_revisions(
        database,
        principal,
        memory.timeline_entry_id,
    )
    return [
        memory_response_for(revision, author, projection, principal)
        for revision, author, projection in rows
    ]


@router.get("", response_model=list[MemoryResponse])
def list_memories(
    principal: CurrentPrincipal,
    database: DatabaseSession,
    author_id: UUID | None = None,
    visibility: MemoryVisibility | None = None,
    created_from: Annotated[datetime | None, Query(alias="from")] = None,
    created_to: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[MemoryResponse]:
    rows = list_authorized_memories(
        database,
        principal,
        author_id=author_id,
        visibility=visibility,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )
    return [
        memory_response_for(memory, author, projection, principal)
        for memory, author, projection in rows
    ]


@router.get("/{memory_id}", response_model=MemoryResponse)
def get_memory(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    row = get_authorized_memory(database, principal, memory_id)
    if row is None:
        raise _not_found()
    return memory_response_for(*row, principal)


@router.post("/{memory_id}/share", response_model=MemoryResponse)
def share_memory(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    memory, author, projection = _author_row_or_error(database, principal, memory_id)
    if memory.visibility != "WORKSPACE":
        _require_team_workspace(database, principal)
        memory.visibility = "WORKSPACE"
        memory.shared_at = datetime.now(UTC)
        _audit(database, principal, "MEMORY_SHARED", memory.id)
        database.commit()
        database.refresh(memory)
    return memory_response_for(memory, author, projection, principal)


@router.post("/{memory_id}/unshare", response_model=MemoryResponse)
def unshare_memory(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    memory, author, projection = _author_row_or_error(database, principal, memory_id)
    if memory.visibility != "PRIVATE":
        invalidate_cited_answers(
            database,
            memory_id=memory.id,
            author_id=memory.author_id,
            include_author=False,
        )
        memory.visibility = "PRIVATE"
        memory.shared_at = None
        _audit(database, principal, "MEMORY_UNSHARED", memory.id)
        database.commit()
        database.refresh(memory)
    return memory_response_for(memory, author, projection, principal)


@router.post("/{memory_id}/retry-processing", response_model=MemoryResponse)
def retry_memory_processing(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
    memory, author, projection = _author_row_or_error(database, principal, memory_id)
    if projection is None:
        projection = MemoryEmbedding(memory_id=memory.id, status="PENDING")
        database.add(projection)
    job = database.scalar(
        select(Job).where(Job.payload_ref == memory.id, Job.type == "EMBED_MEMORY")
    )
    if projection.status != "COMPLETED":
        projection.status = "PENDING"
        projection.last_error_code = None
        if job is None:
            job = Job(
                workspace_id=principal.workspace_id,
                type="EMBED_MEMORY",
                payload_ref=memory.id,
                status="PENDING",
            )
            database.add(job)
        else:
            job.status = "PENDING"
            job.attempts = 0
            job.next_run_at = datetime.now(UTC)
            job.locked_at = None
            job.last_error_code = None
        _audit(database, principal, "MEMORY_PROCESSING_RETRIED", memory.id)
        database.commit()
        database.refresh(memory)
    return memory_response_for(memory, author, projection, principal)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    memory_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> None:
    memory, _author, _projection = _author_row_or_error(database, principal, memory_id)
    revisions = database.scalars(
        select(Memory).where(
            Memory.timeline_entry_id == memory.timeline_entry_id,
            Memory.workspace_id == principal.workspace_id,
            Memory.author_id == principal.user_id,
            Memory.deleted_at.is_(None),
        )
    ).all()
    deleted_at = datetime.now(UTC)
    deleted_markdown_values: list[str] = []
    for revision in revisions:
        deleted_body = revision.body or ""
        if deleted_body:
            deleted_markdown_values.append(deleted_body)
        invalidate_cited_answers(
            database,
            memory_id=revision.id,
            author_id=revision.author_id,
            include_author=True,
        )
        database.execute(
            update(Message)
            .where(Message.memory_id == revision.id)
            .values(
                content="这条记录已删除。",
                status="REDACTED",
                model=None,
                input_tokens=0,
                output_tokens=0,
            )
        )
        linked_conversation_ids = select(Message.conversation_id).where(
            Message.memory_id == revision.id
        )
        database.execute(
            update(Conversation)
            .where(
                Conversation.id.in_(linked_conversation_ids),
                Conversation.title == conversation_title_for(deleted_body),
            )
            .values(title="已删除的记录", updated_at=deleted_at)
        )
        projection = database.get(MemoryEmbedding, revision.id)
        if projection is not None:
            database.delete(projection)
        database.execute(
            update(Job)
            .where(
                Job.payload_ref == revision.id,
                Job.status.in_(("PENDING", "RUNNING", "WAITING_CONFIGURATION", "FAILED")),
            )
            .values(
                status="CANCELLED",
                next_run_at=None,
                locked_at=None,
                last_error_code=None,
            )
        )
        revision.body = None
        revision.title = None
        revision.visibility = "PRIVATE"
        revision.shared_at = None
        revision.timeline_visible = False
        revision.deleted_at = deleted_at
        _audit(database, principal, "MEMORY_DELETED", revision.id)
    database.flush()
    cleanup_unreferenced_assets_for_deleted_markdown(database, principal, deleted_markdown_values)
    database.commit()
