from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel

from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding

MemoryVisibility = Literal["PRIVATE", "WORKSPACE"]
MemoryProcessingStatus = Literal["PENDING", "WAITING_CONFIGURATION", "COMPLETED", "FAILED"]


class MemoryAuthorResponse(BaseModel):
    id: UUID
    display_name: str


class MemoryResponse(BaseModel):
    id: UUID
    body: str
    visibility: MemoryVisibility
    author: MemoryAuthorResponse
    is_owner: bool
    created_at: datetime
    shared_at: datetime | None
    supersedes_id: UUID | None
    processing_status: MemoryProcessingStatus


def memory_response_for(
    memory: Memory,
    author: User,
    projection: MemoryEmbedding | None,
    principal: Principal,
) -> MemoryResponse:
    if memory.body is None:
        raise RuntimeError("deleted memory cannot be serialized")
    visibility: MemoryVisibility = "WORKSPACE" if memory.visibility == "WORKSPACE" else "PRIVATE"
    is_owner = memory.author_id == principal.user_id
    raw_processing_status = projection.status if projection is not None else "PENDING"
    processing_status = cast(
        MemoryProcessingStatus,
        raw_processing_status
        if raw_processing_status in {"PENDING", "WAITING_CONFIGURATION", "COMPLETED", "FAILED"}
        else "FAILED",
    )
    return MemoryResponse(
        id=memory.id,
        body=memory.body,
        visibility=visibility,
        author=MemoryAuthorResponse(id=author.id, display_name=author.display_name),
        is_owner=is_owner,
        created_at=memory.created_at,
        shared_at=memory.shared_at,
        # 非作者不能仅凭一条已共享的补充记录推断出私有原记录的稳定 ID。
        supersedes_id=memory.supersedes_id if is_owner else None,
        processing_status=processing_status,
    )
