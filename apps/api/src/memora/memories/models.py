from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class Memory(Base):
    __tablename__ = "memories"
    __table_args__ = (
        CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_memories_visibility",
        ),
        CheckConstraint(
            "(deleted_at IS NULL AND body IS NOT NULL) OR "
            "(deleted_at IS NOT NULL AND body IS NULL)",
            name="ck_memories_deleted_body",
        ),
        CheckConstraint(
            "(visibility = 'PRIVATE' AND shared_at IS NULL) OR "
            "(visibility = 'WORKSPACE' AND shared_at IS NOT NULL)",
            name="ck_memories_shared_at",
        ),
        CheckConstraint(
            "revision_kind IN ('ROOT', 'UPDATE_CURRENT', 'NEW_VERSION')",
            name="ck_memories_revision_kind",
        ),
        Index("ix_memories_workspace_created_at", "workspace_id", "created_at"),
        Index("ix_memories_author_created_at", "author_id", "created_at"),
        Index(
            "ix_memories_timeline_entry_created_at",
            "timeline_entry_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE")
    supersedes_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("memories.id", ondelete="SET NULL"), index=True
    )
    timeline_entry_id: Mapped[UUID] = mapped_column(Uuid, default=uuid4, index=True)
    timeline_visible: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    revision_kind: Mapped[str] = mapped_column(String(20), default="ROOT")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    shared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
