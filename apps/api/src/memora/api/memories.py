from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from memora.audit.models import AuditEvent
from memora.conversations.service import invalidate_cited_answers
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal, Principal
from memora.identity.models import User
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.memories.service import (
    get_authorized_memory,
    get_memory_for_author_action,
    list_authorized_memories,
)
from memora.retrieval.models import MemoryEmbedding

router = APIRouter(prefix="/memories", tags=["memories"])
MemoryVisibility = Literal["PRIVATE", "WORKSPACE"]


class CreateMemoryRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)
    supersedes_id: UUID | None = None

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


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def create_memory(
    payload: CreateMemoryRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> MemoryResponse:
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

    memory = Memory(
        id=uuid4(),
        workspace_id=principal.workspace_id,
        author_id=principal.user_id,
        body=payload.body,
        visibility="PRIVATE",
        supersedes_id=payload.supersedes_id,
    )
    database.add(memory)
    # payload_ref 没有 ORM relationship；先 flush 可保证 PostgreSQL 在同一事务中
    # 先插入 memory，再插入带外键的 outbox job。
    database.flush()
    projection = MemoryEmbedding(memory_id=memory.id, status="PENDING")
    database.add(projection)
    database.add(
        Job(
            workspace_id=principal.workspace_id,
            type="EMBED_MEMORY",
            payload_ref=memory.id,
            status="PENDING",
        )
    )
    _audit(database, principal, "MEMORY_CREATED", memory.id)
    database.commit()
    database.refresh(memory)
    author = database.get(User, principal.user_id)
    if author is None:
        raise RuntimeError("authenticated user disappeared")
    return memory_response_for(memory, author, projection, principal)


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
    memory, _author, projection = _author_row_or_error(database, principal, memory_id)
    invalidate_cited_answers(
        database,
        memory_id=memory.id,
        author_id=memory.author_id,
        include_author=True,
    )
    memory.body = None
    memory.visibility = "PRIVATE"
    memory.shared_at = None
    memory.deleted_at = datetime.now(UTC)
    if projection is not None:
        database.delete(projection)
    database.execute(
        update(Job)
        .where(
            Job.payload_ref == memory.id,
            Job.status.in_(("PENDING", "RUNNING", "WAITING_CONFIGURATION", "FAILED")),
        )
        .values(
            status="CANCELLED",
            next_run_at=None,
            locked_at=None,
            last_error_code=None,
        )
    )
    _audit(database, principal, "MEMORY_DELETED", memory.id)
    database.commit()
