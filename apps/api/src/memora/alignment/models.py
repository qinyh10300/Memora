from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class AlignmentTopic(Base):
    __tablename__ = "alignment_topics"
    __table_args__ = (
        CheckConstraint(
            "status IN ('OPEN', 'DECIDED', 'ARCHIVED')",
            name="ck_alignment_topics_status",
        ),
        Index("ix_alignment_topics_workspace_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(240))
    context: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="OPEN")
    evidence_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence_to: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AlignmentPosition(Base):
    __tablename__ = "alignment_positions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CANDIDATE', 'CONFIRMED', 'REVISED', 'WITHDRAWN', 'NO_RECORDED_POSITION')",
            name="ck_alignment_positions_status",
        ),
        UniqueConstraint("topic_id", "user_id", name="uq_alignment_positions_topic_user"),
        Index("ix_alignment_positions_topic_status", "topic_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    topic_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("alignment_topics.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AlignmentPositionSource(Base):
    __tablename__ = "alignment_position_sources"
    __table_args__ = (
        UniqueConstraint(
            "position_id",
            "memory_id",
            name="uq_alignment_position_sources_position_memory",
        ),
        Index("ix_alignment_position_sources_memory", "memory_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    position_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("alignment_positions.id", ondelete="CASCADE"),
        index=True,
    )
    memory_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("memories.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DecisionRecord(Base):
    __tablename__ = "decision_records"
    __table_args__ = (
        Index("ix_decision_records_topic_created", "topic_id", "created_at"),
        Index("ix_decision_records_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    topic_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("alignment_topics.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    published_by_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    memory_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("memories.id", ondelete="RESTRICT"),
        unique=True,
    )
    supersedes_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("decision_records.id", ondelete="SET NULL"),
        index=True,
    )
    decision: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    alternatives: Mapped[list[str]] = mapped_column(JSON)
    position_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
