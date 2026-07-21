from datetime import datetime
from uuid import UUID

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class MemoryEmbedding(Base):
    __tablename__ = "memory_embeddings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'WAITING_CONFIGURATION', 'COMPLETED', 'FAILED')",
            name="ck_memory_embeddings_status",
        ),
        CheckConstraint(
            "status != 'COMPLETED' OR "
            "(embedding IS NOT NULL AND model IS NOT NULL AND dimensions IS NOT NULL)",
            name="ck_memory_embeddings_completed",
        ),
    )

    memory_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("memories.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    model: Mapped[str | None] = mapped_column(String(160), index=True)
    dimensions: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR())
    usage_tokens: Mapped[int] = mapped_column(Integer, default=0)
    last_error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
