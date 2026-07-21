from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.orm import Session

from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding


def authorized_memories_statement(
    principal: Principal,
) -> Select[tuple[Memory, User, MemoryEmbedding | None]]:
    """构造所有 memory 读取路径必须复用的授权候选查询。"""
    return (
        select(Memory, User)
        .join(User, User.id == Memory.author_id)
        .add_columns(MemoryEmbedding)
        .outerjoin(MemoryEmbedding, MemoryEmbedding.memory_id == Memory.id)
        .where(
            Memory.workspace_id == principal.workspace_id,
            Memory.deleted_at.is_(None),
            or_(
                Memory.author_id == principal.user_id,
                Memory.visibility == "WORKSPACE",
            ),
        )
    )


def list_authorized_memories(
    database: Session,
    principal: Principal,
    *,
    author_id: UUID | None = None,
    visibility: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 100,
) -> list[tuple[Memory, User, MemoryEmbedding | None]]:
    statement = authorized_memories_statement(principal)
    filters = []
    if author_id is not None:
        filters.append(Memory.author_id == author_id)
    if visibility is not None:
        filters.append(Memory.visibility == visibility)
    if created_from is not None:
        filters.append(Memory.created_at >= created_from)
    if created_to is not None:
        filters.append(Memory.created_at < created_to)
    if filters:
        statement = statement.where(and_(*filters))
    return list(
        database.execute(statement.order_by(Memory.created_at.desc(), Memory.id).limit(limit))
        .tuples()
        .all()
    )


def get_authorized_memory(
    database: Session, principal: Principal, memory_id: UUID
) -> tuple[Memory, User, MemoryEmbedding | None] | None:
    return (
        database.execute(authorized_memories_statement(principal).where(Memory.id == memory_id))
        .tuples()
        .one_or_none()
    )


def get_memory_for_author_action(
    database: Session, principal: Principal, memory_id: UUID
) -> tuple[Memory, User, MemoryEmbedding | None] | None:
    return (
        database.execute(
            select(Memory, User, MemoryEmbedding)
            .join(User, User.id == Memory.author_id)
            .outerjoin(MemoryEmbedding, MemoryEmbedding.memory_id == Memory.id)
            .where(
                Memory.id == memory_id,
                Memory.workspace_id == principal.workspace_id,
                Memory.deleted_at.is_(None),
            )
        )
        .tuples()
        .one_or_none()
    )
