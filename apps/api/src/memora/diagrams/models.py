from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class Diagram(Base):
    __tablename__ = "diagrams"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('MIND_MAP', 'FLOWCHART', 'TIMELINE')",
            name="ck_diagrams_kind",
        ),
        CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_diagrams_visibility",
        ),
        Index("ix_diagrams_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_diagrams_owner_updated", "owner_id", "updated_at"),
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
    kind: Mapped[str] = mapped_column(String(20), default="MIND_MAP")
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE")
    nodes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    edges: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
