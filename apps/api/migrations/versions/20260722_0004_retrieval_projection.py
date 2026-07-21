"""add reliable embedding projection

Revision ID: 20260722_0004
Revises: 20260722_0003
Create Date: 2026-07-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import VECTOR

revision: str = "20260722_0004"
down_revision: str | None = "20260722_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("jobs", "next_run_at", existing_type=sa.DateTime(timezone=True), nullable=True)
    op.add_column("jobs", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_jobs_locked_at", "jobs", ["locked_at"], unique=False)

    op.create_table(
        "memory_embeddings",
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("model", sa.String(length=160), nullable=True),
        sa.Column("dimensions", sa.Integer(), nullable=True),
        sa.Column("embedding", VECTOR(), nullable=True),
        sa.Column("usage_tokens", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status != 'COMPLETED' OR "
            "(embedding IS NOT NULL AND model IS NOT NULL AND dimensions IS NOT NULL)",
            name="ck_memory_embeddings_completed",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'WAITING_CONFIGURATION', 'COMPLETED', 'FAILED')",
            name="ck_memory_embeddings_status",
        ),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("memory_id"),
    )
    op.create_index("ix_memory_embeddings_status", "memory_embeddings", ["status"])
    op.create_index("ix_memory_embeddings_model", "memory_embeddings", ["model"])
    op.execute(
        "INSERT INTO memory_embeddings "
        "(memory_id, status, usage_tokens, created_at, updated_at) "
        "SELECT id, 'PENDING', 0, now(), now() FROM memories WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_memory_embeddings_model", table_name="memory_embeddings")
    op.drop_index("ix_memory_embeddings_status", table_name="memory_embeddings")
    op.drop_table("memory_embeddings")
    op.drop_index("ix_jobs_locked_at", table_name="jobs")
    op.drop_column("jobs", "locked_at")
    op.execute("UPDATE jobs SET next_run_at = now() WHERE next_run_at IS NULL")
    op.alter_column("jobs", "next_run_at", existing_type=sa.DateTime(timezone=True), nullable=False)
