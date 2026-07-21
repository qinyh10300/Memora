"""add private memories, embedding outbox and audit events

Revision ID: 20260722_0003
Revises: 20260722_0002
Create Date: 2026-07-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260722_0003"
down_revision: str | None = "20260722_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("supersedes_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(deleted_at IS NULL AND body IS NOT NULL) OR "
            "(deleted_at IS NOT NULL AND body IS NULL)",
            name="ck_memories_deleted_body",
        ),
        sa.CheckConstraint(
            "(visibility = 'PRIVATE' AND shared_at IS NULL) OR "
            "(visibility = 'WORKSPACE' AND shared_at IS NOT NULL)",
            name="ck_memories_shared_at",
        ),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_memories_visibility",
        ),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supersedes_id"], ["memories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_memories_workspace_id", "memories", ["workspace_id"], unique=False)
    op.create_index("ix_memories_author_id", "memories", ["author_id"], unique=False)
    op.create_index("ix_memories_supersedes_id", "memories", ["supersedes_id"], unique=False)
    op.create_index("ix_memories_deleted_at", "memories", ["deleted_at"], unique=False)
    op.create_index(
        "ix_memories_workspace_created_at",
        "memories",
        ["workspace_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_memories_author_created_at",
        "memories",
        ["author_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("payload_ref", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "next_run_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
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
            "status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', "
            "'WAITING_CONFIGURATION')",
            name="ck_jobs_status",
        ),
        sa.ForeignKeyConstraint(["payload_ref"], ["memories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jobs_workspace_id", "jobs", ["workspace_id"], unique=False)
    op.create_index("ix_jobs_payload_ref", "jobs", ["payload_ref"], unique=False)
    op.create_index(
        "ix_jobs_claim",
        "jobs",
        ["status", "next_run_at", "created_at"],
        unique=False,
    )

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_workspace_id", "audit_events", ["workspace_id"])
    op.create_index("ix_audit_events_actor_id", "audit_events", ["actor_id"])
    op.create_index(
        "ix_audit_events_resource",
        "audit_events",
        ["resource_type", "resource_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_resource", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_id", table_name="audit_events")
    op.drop_index("ix_audit_events_workspace_id", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_jobs_claim", table_name="jobs")
    op.drop_index("ix_jobs_payload_ref", table_name="jobs")
    op.drop_index("ix_jobs_workspace_id", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_memories_author_created_at", table_name="memories")
    op.drop_index("ix_memories_workspace_created_at", table_name="memories")
    op.drop_index("ix_memories_deleted_at", table_name="memories")
    op.drop_index("ix_memories_supersedes_id", table_name="memories")
    op.drop_index("ix_memories_author_id", table_name="memories")
    op.drop_index("ix_memories_workspace_id", table_name="memories")
    op.drop_table("memories")
