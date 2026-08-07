"""add recoverable agent executions and safe events

Revision ID: 20260807_0014
Revises: 20260807_0013
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0014"
down_revision: str | None = "20260807_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("model_id", sa.String(length=160), nullable=True),
        sa.Column("saved_memory_id", sa.Uuid(), nullable=True),
        sa.Column("next_event_sequence", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('RECEIVED', 'PLANNING', 'TOOL_PENDING', 'TOOL_RUNNING', "
            "'MODEL_RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', "
            "'DEGRADED', 'FAILED')",
            name="ck_agent_executions_status",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["saved_memory_id"], ["memories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_executions_workspace_id", "agent_executions", ["workspace_id"])
    op.create_index("ix_agent_executions_actor_id", "agent_executions", ["actor_id"])
    op.create_index("ix_agent_executions_status", "agent_executions", ["status"])
    op.create_index("ix_agent_executions_saved_memory_id", "agent_executions", ["saved_memory_id"])
    op.create_index(
        "ix_agent_executions_workspace_status",
        "agent_executions",
        ["workspace_id", "status"],
    )
    op.create_index(
        "ix_agent_executions_actor_created_at",
        "agent_executions",
        ["actor_id", "created_at"],
    )

    op.create_table(
        "agent_events",
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("step_id", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("execution_status", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('RUNNING', 'COMPLETED', 'SKIPPED', 'DEGRADED', 'REJECTED', 'FAILED')",
            name="ck_agent_events_status",
        ),
        sa.CheckConstraint(
            "execution_status IN ('RECEIVED', 'PLANNING', 'TOOL_PENDING', 'TOOL_RUNNING', "
            "'MODEL_RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', "
            "'DEGRADED', 'FAILED')",
            name="ck_agent_events_execution_status",
        ),
        sa.ForeignKeyConstraint(["execution_id"], ["agent_executions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("execution_id", "sequence"),
        sa.UniqueConstraint("execution_id", "sequence", name="uq_agent_events_sequence"),
    )


def downgrade() -> None:
    op.drop_table("agent_events")
    op.drop_index("ix_agent_executions_actor_created_at", table_name="agent_executions")
    op.drop_index("ix_agent_executions_workspace_status", table_name="agent_executions")
    op.drop_index("ix_agent_executions_saved_memory_id", table_name="agent_executions")
    op.drop_index("ix_agent_executions_status", table_name="agent_executions")
    op.drop_index("ix_agent_executions_actor_id", table_name="agent_executions")
    op.drop_index("ix_agent_executions_workspace_id", table_name="agent_executions")
    op.drop_table("agent_executions")
