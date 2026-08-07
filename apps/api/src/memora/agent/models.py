from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class AgentExecution(Base):
    __tablename__ = "agent_executions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('RECEIVED', 'PLANNING', 'TOOL_PENDING', 'TOOL_RUNNING', "
            "'MODEL_RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', "
            "'DEGRADED', 'FAILED')",
            name="ck_agent_executions_status",
        ),
        Index("ix_agent_executions_workspace_status", "workspace_id", "status"),
        Index("ix_agent_executions_actor_created_at", "actor_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="RECEIVED", index=True)
    model_id: Mapped[str | None] = mapped_column(String(160))
    saved_memory_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("memories.id", ondelete="SET NULL"), index=True
    )
    next_event_sequence: Mapped[int] = mapped_column(Integer, default=1)
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentEvent(Base):
    __tablename__ = "agent_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('RUNNING', 'COMPLETED', 'SKIPPED', 'DEGRADED', 'REJECTED', 'FAILED')",
            name="ck_agent_events_status",
        ),
        CheckConstraint(
            "execution_status IN ('RECEIVED', 'PLANNING', 'TOOL_PENDING', 'TOOL_RUNNING', "
            "'MODEL_RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', "
            "'DEGRADED', 'FAILED')",
            name="ck_agent_events_execution_status",
        ),
    )

    execution_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("agent_executions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    step_id: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(24))
    execution_status: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(160))
    detail: Mapped[str | None] = mapped_column(String(500))
    elapsed_ms: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    item_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
