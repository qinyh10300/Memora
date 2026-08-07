from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, Field

from memora.documents.schemas import DocumentCitationResponse
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding

MemoryVisibility = Literal["PRIVATE", "WORKSPACE"]
MemoryProcessingStatus = Literal["PENDING", "WAITING_CONFIGURATION", "COMPLETED", "FAILED"]
MemoryRevisionKind = Literal["ROOT", "UPDATE_CURRENT", "NEW_VERSION"]


class MemoryAuthorResponse(BaseModel):
    id: UUID
    display_name: str


class MemoryResponse(BaseModel):
    id: UUID
    title: str | None
    body: str
    visibility: MemoryVisibility
    author: MemoryAuthorResponse
    is_owner: bool
    created_at: datetime
    shared_at: datetime | None
    supersedes_id: UUID | None
    timeline_entry_id: UUID
    timeline_visible: bool
    revision_kind: MemoryRevisionKind
    processing_status: MemoryProcessingStatus
    document_citations: list[DocumentCitationResponse] = Field(default_factory=list)


def memory_response_for(
    memory: Memory,
    author: User,
    projection: MemoryEmbedding | None,
    principal: Principal,
    document_citations: list[DocumentCitationResponse] | None = None,
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
    revision_kind = cast(
        MemoryRevisionKind,
        memory.revision_kind
        if memory.revision_kind in {"ROOT", "UPDATE_CURRENT", "NEW_VERSION"}
        else "ROOT",
    )
    return MemoryResponse(
        id=memory.id,
        title=memory.title,
        body=memory.body,
        visibility=visibility,
        author=MemoryAuthorResponse(id=author.id, display_name=author.display_name),
        is_owner=is_owner,
        created_at=memory.created_at,
        shared_at=memory.shared_at,
        # 非作者不能仅凭一条已共享的补充记录推断出私有原记录的稳定 ID。
        supersedes_id=memory.supersedes_id if is_owner else None,
        timeline_entry_id=memory.timeline_entry_id,
        timeline_visible=memory.timeline_visible,
        revision_kind=revision_kind,
        processing_status=processing_status,
        document_citations=document_citations or [],
    )
