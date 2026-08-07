from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
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


class DocumentParseJob(Base):
    __tablename__ = "document_parse_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED', 'PARSING', 'OCR', 'COMPLETED', 'FAILED', "
            "'CANCEL_REQUESTED', 'CANCELLED')",
            name="ck_document_parse_jobs_status",
        ),
        CheckConstraint("attempts >= 0", name="ck_document_parse_jobs_attempts"),
        CheckConstraint("processed_pages >= 0", name="ck_document_parse_jobs_processed_pages"),
        CheckConstraint("text_page_count >= 0", name="ck_document_parse_jobs_text_pages"),
        CheckConstraint("ocr_page_count >= 0", name="ck_document_parse_jobs_ocr_pages"),
        CheckConstraint("chunk_count >= 0", name="ck_document_parse_jobs_chunks"),
        UniqueConstraint("asset_id", name="uq_document_parse_jobs_asset_id"),
        Index("ix_document_parse_jobs_claim", "status", "next_run_at", "created_at"),
        Index("ix_document_parse_jobs_workspace_owner", "workspace_id", "owner_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("assets.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    page_count: Mapped[int | None] = mapped_column(Integer)
    processed_pages: Mapped[int] = mapped_column(Integer, default=0)
    text_page_count: Mapped[int] = mapped_column(Integer, default=0)
    ocr_page_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(80))
    warning_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DocumentPage(Base):
    __tablename__ = "document_pages"
    __table_args__ = (
        UniqueConstraint("parse_job_id", "page_number", name="uq_document_pages_job_page"),
        CheckConstraint("page_number > 0", name="ck_document_pages_number"),
        CheckConstraint("char_count >= 0", name="ck_document_pages_char_count"),
        CheckConstraint(
            "quality_score >= 0 AND quality_score <= 1",
            name="ck_document_pages_quality",
        ),
        CheckConstraint(
            "extraction_method IN ('TEXT', 'OCR', 'EMPTY', 'OCR_UNAVAILABLE')",
            name="ck_document_pages_method",
        ),
        Index("ix_document_pages_asset_page", "asset_id", "page_number"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    parse_job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("document_parse_jobs.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    page_number: Mapped[int] = mapped_column(Integer)
    extraction_method: Mapped[str] = mapped_column(String(24))
    title: Mapped[str | None] = mapped_column(String(240))
    text: Mapped[str | None] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_score: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("parse_job_id", "ordinal", name="uq_document_chunks_job_ordinal"),
        CheckConstraint("page_number > 0", name="ck_document_chunks_page_number"),
        CheckConstraint("ordinal >= 0", name="ck_document_chunks_ordinal"),
        CheckConstraint(
            "char_start >= 0 AND char_end > char_start",
            name="ck_document_chunks_char_range",
        ),
        CheckConstraint(
            "embedding_status IN ('PENDING', 'RUNNING', 'WAITING_CONFIGURATION', "
            "'COMPLETED', 'FAILED')",
            name="ck_document_chunks_embedding_status",
        ),
        CheckConstraint(
            "embedding_status != 'COMPLETED' OR "
            "(embedding IS NOT NULL AND embedding_model IS NOT NULL "
            "AND embedding_dimensions IS NOT NULL)",
            name="ck_document_chunks_embedding_completed",
        ),
        Index("ix_document_chunks_asset_page", "asset_id", "page_number", "ordinal"),
        Index("ix_document_chunks_embedding_claim", "embedding_status", "embedding_next_run_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    parse_job_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("document_parse_jobs.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    page_number: Mapped[int] = mapped_column(Integer)
    ordinal: Mapped[int] = mapped_column(Integer)
    heading: Mapped[str | None] = mapped_column(String(240))
    text: Mapped[str] = mapped_column(Text)
    char_start: Mapped[int] = mapped_column(Integer)
    char_end: Mapped[int] = mapped_column(Integer)
    embedding_status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    embedding_model: Mapped[str | None] = mapped_column(String(160), index=True)
    embedding_dimensions: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR())
    embedding_usage_tokens: Mapped[int] = mapped_column(Integer, default=0)
    embedding_attempts: Mapped[int] = mapped_column(Integer, default=0)
    embedding_next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    embedding_last_error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MemoryDocumentCitation(Base):
    __tablename__ = "memory_document_citations"
    __table_args__ = (
        UniqueConstraint("memory_id", "ordinal", name="uq_memory_document_citations_ordinal"),
        CheckConstraint("page_number > 0", name="ck_memory_document_citations_page"),
        CheckConstraint("ordinal >= 0", name="ck_memory_document_citations_ordinal"),
        Index("ix_memory_document_citations_asset", "asset_id", "memory_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    memory_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("memories.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    chunk_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("document_chunks.id", ondelete="SET NULL"), index=True
    )
    page_number: Mapped[int] = mapped_column(Integer)
    heading: Mapped[str | None] = mapped_column(String(240))
    excerpt: Mapped[str] = mapped_column(Text)
    ordinal: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
