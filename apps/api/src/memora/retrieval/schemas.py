from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from memora.identity.models import User
from memora.memories.models import Memory


class EvidenceAuthorResponse(BaseModel):
    id: UUID
    display_name: str


class EvidenceCitationResponse(BaseModel):
    memory_id: UUID
    excerpt: str
    author: EvidenceAuthorResponse
    created_at: datetime
    href: str


def evidence_citation_for(
    memory: Memory,
    author: User,
    *,
    excerpt: str,
) -> EvidenceCitationResponse:
    return EvidenceCitationResponse(
        memory_id=memory.id,
        excerpt=excerpt,
        author=EvidenceAuthorResponse(id=author.id, display_name=author.display_name),
        created_at=memory.created_at,
        href=f"/#memory-{memory.id}",
    )
