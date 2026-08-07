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


class GeneratedReport(Base):
    __tablename__ = "generated_reports"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('PERSONAL', 'MEMBER', 'WORKSPACE', 'PROJECT')",
            name="ck_generated_reports_scope",
        ),
        CheckConstraint(
            "status IN ('GENERATED', 'NO_EVIDENCE')",
            name="ck_generated_reports_status",
        ),
        CheckConstraint(
            "model_status IN ('AVAILABLE', 'DISABLED', 'DEGRADED')",
            name="ck_generated_reports_model_status",
        ),
        CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_generated_reports_visibility",
        ),
        Index("ix_generated_reports_workspace_created", "workspace_id", "created_at"),
        Index("ix_generated_reports_owner_created", "created_by_user_id", "created_at"),
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
    subject_author_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    saved_memory_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("memories.id", ondelete="SET NULL"),
        index=True,
    )
    scope: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20))
    model_status: Mapped[str] = mapped_column(String(20))
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE")
    preset: Mapped[str | None] = mapped_column(String(32))
    topic: Mapped[str] = mapped_column(String(500))
    title: Mapped[str] = mapped_column(String(620))
    summary: Mapped[str] = mapped_column(Text)
    sections: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    contributors: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    created_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_to: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportSource(Base):
    __tablename__ = "report_sources"
    __table_args__ = (
        UniqueConstraint("report_id", "memory_id", name="uq_report_sources_report_memory"),
        Index("ix_report_sources_memory", "memory_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("generated_reports.id", ondelete="CASCADE"),
        index=True,
    )
    memory_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("memories.id", ondelete="CASCADE"),
    )
    author_id_at_generation: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    memory_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportSubscription(Base):
    __tablename__ = "report_subscriptions"
    __table_args__ = (
        CheckConstraint(
            "preset IN ('MISSED', 'MEETING', 'ONBOARDING', 'HANDOVER', 'KNOWLEDGE_GAPS')",
            name="ck_report_subscriptions_preset",
        ),
        CheckConstraint(
            "scope IN ('PERSONAL', 'MEMBER', 'WORKSPACE', 'PROJECT')",
            name="ck_report_subscriptions_scope",
        ),
        CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_report_subscriptions_visibility",
        ),
        CheckConstraint(
            "cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')",
            name="ck_report_subscriptions_cadence",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'PAUSED')",
            name="ck_report_subscriptions_status",
        ),
        Index("ix_report_subscriptions_due", "status", "next_run_at"),
        Index("ix_report_subscriptions_user_created", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    subject_author_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    last_report_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("generated_reports.id", ondelete="SET NULL"),
    )
    preset: Mapped[str] = mapped_column(String(32))
    scope: Mapped[str] = mapped_column(String(20))
    topic: Mapped[str] = mapped_column(String(500))
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE")
    cadence: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
