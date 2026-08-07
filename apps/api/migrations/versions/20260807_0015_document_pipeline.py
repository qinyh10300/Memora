"""add asynchronous document parsing and page citations

Revision ID: 20260807_0015
Revises: 20260807_0014
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import VECTOR

revision: str = "20260807_0015"
down_revision: str | None = "20260807_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_parse_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("processed_pages", sa.Integer(), nullable=False),
        sa.Column("text_page_count", sa.Integer(), nullable=False),
        sa.Column("ocr_page_count", sa.Integer(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("warning_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'PARSING', 'OCR', 'COMPLETED', 'FAILED', "
            "'CANCEL_REQUESTED', 'CANCELLED')",
            name="ck_document_parse_jobs_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_document_parse_jobs_attempts"),
        sa.CheckConstraint("processed_pages >= 0", name="ck_document_parse_jobs_processed_pages"),
        sa.CheckConstraint("text_page_count >= 0", name="ck_document_parse_jobs_text_pages"),
        sa.CheckConstraint("ocr_page_count >= 0", name="ck_document_parse_jobs_ocr_pages"),
        sa.CheckConstraint("chunk_count >= 0", name="ck_document_parse_jobs_chunks"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id"),
    )
    op.create_index("ix_document_parse_jobs_asset_id", "document_parse_jobs", ["asset_id"])
    op.create_index("ix_document_parse_jobs_workspace_id", "document_parse_jobs", ["workspace_id"])
    op.create_index("ix_document_parse_jobs_owner_id", "document_parse_jobs", ["owner_id"])
    op.create_index("ix_document_parse_jobs_status", "document_parse_jobs", ["status"])
    op.create_index("ix_document_parse_jobs_locked_at", "document_parse_jobs", ["locked_at"])
    op.create_index(
        "ix_document_parse_jobs_claim",
        "document_parse_jobs",
        ["status", "next_run_at", "created_at"],
    )
    op.create_index(
        "ix_document_parse_jobs_workspace_owner",
        "document_parse_jobs",
        ["workspace_id", "owner_id"],
    )

    op.create_table(
        "document_pages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("parse_job_id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("extraction_method", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("page_number > 0", name="ck_document_pages_number"),
        sa.CheckConstraint("char_count >= 0", name="ck_document_pages_char_count"),
        sa.CheckConstraint(
            "quality_score >= 0 AND quality_score <= 1", name="ck_document_pages_quality"
        ),
        sa.CheckConstraint(
            "extraction_method IN ('TEXT', 'OCR', 'EMPTY', 'OCR_UNAVAILABLE')",
            name="ck_document_pages_method",
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parse_job_id"], ["document_parse_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("parse_job_id", "page_number", name="uq_document_pages_job_page"),
    )
    for column in ("parse_job_id", "asset_id", "workspace_id", "owner_id"):
        op.create_index(f"ix_document_pages_{column}", "document_pages", [column])
    op.create_index("ix_document_pages_asset_page", "document_pages", ["asset_id", "page_number"])

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("parse_job_id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(length=240), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("char_start", sa.Integer(), nullable=False),
        sa.Column("char_end", sa.Integer(), nullable=False),
        sa.Column("embedding_status", sa.String(length=30), nullable=False),
        sa.Column("embedding_model", sa.String(length=160), nullable=True),
        sa.Column("embedding_dimensions", sa.Integer(), nullable=True),
        sa.Column("embedding", VECTOR(), nullable=True),
        sa.Column("embedding_usage_tokens", sa.Integer(), nullable=False),
        sa.Column("embedding_attempts", sa.Integer(), nullable=False),
        sa.Column(
            "embedding_next_run_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column("embedding_last_error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("page_number > 0", name="ck_document_chunks_page_number"),
        sa.CheckConstraint("ordinal >= 0", name="ck_document_chunks_ordinal"),
        sa.CheckConstraint(
            "char_start >= 0 AND char_end > char_start", name="ck_document_chunks_char_range"
        ),
        sa.CheckConstraint(
            "embedding_status IN ('PENDING', 'RUNNING', 'WAITING_CONFIGURATION', "
            "'COMPLETED', 'FAILED')",
            name="ck_document_chunks_embedding_status",
        ),
        sa.CheckConstraint(
            "embedding_status != 'COMPLETED' OR "
            "(embedding IS NOT NULL AND embedding_model IS NOT NULL "
            "AND embedding_dimensions IS NOT NULL)",
            name="ck_document_chunks_embedding_completed",
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parse_job_id"], ["document_parse_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("parse_job_id", "ordinal", name="uq_document_chunks_job_ordinal"),
    )
    for column in (
        "parse_job_id",
        "asset_id",
        "workspace_id",
        "owner_id",
        "embedding_status",
        "embedding_model",
    ):
        op.create_index(f"ix_document_chunks_{column}", "document_chunks", [column])
    op.create_index(
        "ix_document_chunks_asset_page",
        "document_chunks",
        ["asset_id", "page_number", "ordinal"],
    )
    op.create_index(
        "ix_document_chunks_embedding_claim",
        "document_chunks",
        ["embedding_status", "embedding_next_run_at"],
    )
    op.execute(
        "CREATE INDEX ix_document_chunks_fts ON document_chunks "
        "USING gin (to_tsvector('simple', coalesce(heading, '') || ' ' || text))"
    )
    op.execute(
        "CREATE INDEX ix_document_chunks_text_trgm ON document_chunks USING gin (text gin_trgm_ops)"
    )

    op.create_table(
        "memory_document_citations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_id", sa.Uuid(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(length=240), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("page_number > 0", name="ck_memory_document_citations_page"),
        sa.CheckConstraint("ordinal >= 0", name="ck_memory_document_citations_ordinal"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chunk_id"], ["document_chunks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("memory_id", "ordinal", name="uq_memory_document_citations_ordinal"),
    )
    for column in ("memory_id", "asset_id", "chunk_id"):
        op.create_index(
            f"ix_memory_document_citations_{column}", "memory_document_citations", [column]
        )
    op.create_index(
        "ix_memory_document_citations_asset",
        "memory_document_citations",
        ["asset_id", "memory_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_memory_document_citations_asset", table_name="memory_document_citations")
    for column in ("chunk_id", "asset_id", "memory_id"):
        op.drop_index(
            f"ix_memory_document_citations_{column}", table_name="memory_document_citations"
        )
    op.drop_table("memory_document_citations")

    op.drop_index("ix_document_chunks_text_trgm", table_name="document_chunks")
    op.drop_index("ix_document_chunks_fts", table_name="document_chunks")
    op.drop_index("ix_document_chunks_embedding_claim", table_name="document_chunks")
    op.drop_index("ix_document_chunks_asset_page", table_name="document_chunks")
    for column in (
        "embedding_model",
        "embedding_status",
        "owner_id",
        "workspace_id",
        "asset_id",
        "parse_job_id",
    ):
        op.drop_index(f"ix_document_chunks_{column}", table_name="document_chunks")
    op.drop_table("document_chunks")

    op.drop_index("ix_document_pages_asset_page", table_name="document_pages")
    for column in ("owner_id", "workspace_id", "asset_id", "parse_job_id"):
        op.drop_index(f"ix_document_pages_{column}", table_name="document_pages")
    op.drop_table("document_pages")

    op.drop_index("ix_document_parse_jobs_workspace_owner", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_claim", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_locked_at", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_status", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_owner_id", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_workspace_id", table_name="document_parse_jobs")
    op.drop_index("ix_document_parse_jobs_asset_id", table_name="document_parse_jobs")
    op.drop_table("document_parse_jobs")
