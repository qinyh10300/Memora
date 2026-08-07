from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class VisualProject(Base):
    __tablename__ = "visual_projects"
    __table_args__ = (
        CheckConstraint("mode IN ('STRUCTURED', 'IMAGE')", name="ck_visual_projects_mode"),
        CheckConstraint(
            "kind IN ('SCIENTIFIC', 'MIND_MAP', 'FLOWCHART', 'TIMELINE')",
            name="ck_visual_projects_kind",
        ),
        CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_visual_projects_visibility",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'QUEUED', 'GENERATING', 'WAITING_CONFIRMATION', "
            "'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_visual_projects_status",
        ),
        Index("ix_visual_projects_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_visual_projects_owner_updated", "owner_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    owner_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(120))
    mode: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(24))
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE")
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class VisualGenerationJob(Base):
    __tablename__ = "visual_generation_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'WAITING_CONFIGURATION', "
            "'WAITING_CONFIRMATION', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_visual_jobs_status",
        ),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_visual_jobs_progress"),
        CheckConstraint("credit_cost > 0", name="ck_visual_jobs_credit_cost"),
        Index("ix_visual_jobs_project_id", "project_id"),
        Index("ix_visual_jobs_workspace_id", "workspace_id"),
        Index("ix_visual_jobs_requested_by_user_id", "requested_by_user_id"),
        Index("ix_visual_jobs_locked_at", "locked_at"),
        Index("ix_visual_jobs_claim", "status", "next_run_at", "created_at"),
        Index("ix_visual_jobs_project_created", "project_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("visual_projects.id", ondelete="CASCADE"),
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
    )
    requested_by_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    reservation_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("credit_reservations.id", ondelete="RESTRICT"),
        unique=True,
    )
    mode: Mapped[str] = mapped_column(String(20))
    model_id: Mapped[str] = mapped_column(String(64))
    provider_model: Mapped[str] = mapped_column(String(120))
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default="QUEUED")
    stage: Mapped[str] = mapped_column(String(40), default="QUEUED")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    credit_cost: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class VisualVersion(Base):
    __tablename__ = "visual_versions"
    __table_args__ = (
        CheckConstraint("version_number > 0", name="ck_visual_versions_number_positive"),
        CheckConstraint(
            "status IN ('CANDIDATE', 'CONFIRMED')",
            name="ck_visual_versions_status",
        ),
        UniqueConstraint("project_id", "version_number", name="uq_visual_versions_project_number"),
        Index("ix_visual_versions_project_created", "project_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("visual_projects.id", ondelete="CASCADE"),
        index=True,
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("visual_generation_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="CANDIDATE")
    model_id: Mapped[str] = mapped_column(String(64))
    provider_model: Mapped[str] = mapped_column(String(120))
    prompt: Mapped[str] = mapped_column(Text)
    revised_prompt: Mapped[str | None] = mapped_column(Text)
    graph: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    asset_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("assets.id", ondelete="RESTRICT"),
        index=True,
    )
    diagram_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("diagrams.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VisualSource(Base):
    __tablename__ = "visual_sources"
    __table_args__ = (
        UniqueConstraint("job_id", "memory_id", name="uq_visual_sources_job_memory"),
        Index("ix_visual_sources_memory", "memory_id"),
        Index("ix_visual_sources_version", "version_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("visual_generation_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    version_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("visual_versions.id", ondelete="CASCADE"),
    )
    memory_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("memories.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
