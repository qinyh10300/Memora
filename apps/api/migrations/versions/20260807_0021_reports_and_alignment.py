"""add persistent reports, alignment topics, and decision records

Revision ID: 20260807_0021
Revises: 20260807_0020
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0021"
down_revision: str | Sequence[str] | None = "20260807_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "generated_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("subject_author_id", sa.Uuid(), nullable=True),
        sa.Column("saved_memory_id", sa.Uuid(), nullable=True),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("model_status", sa.String(length=20), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("preset", sa.String(length=32), nullable=True),
        sa.Column("topic", sa.String(length=500), nullable=False),
        sa.Column("title", sa.String(length=620), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("sections", sa.JSON(), nullable=False),
        sa.Column("contributors", sa.JSON(), nullable=False),
        sa.Column("created_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "scope IN ('PERSONAL', 'MEMBER', 'WORKSPACE', 'PROJECT')",
            name="ck_generated_reports_scope",
        ),
        sa.CheckConstraint(
            "status IN ('GENERATED', 'NO_EVIDENCE')",
            name="ck_generated_reports_status",
        ),
        sa.CheckConstraint(
            "model_status IN ('AVAILABLE', 'DISABLED', 'DEGRADED')",
            name="ck_generated_reports_model_status",
        ),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_generated_reports_visibility",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["saved_memory_id"], ["memories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_generated_reports_workspace_id", "generated_reports", ["workspace_id"])
    op.create_index(
        "ix_generated_reports_created_by_user_id",
        "generated_reports",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_generated_reports_subject_author_id",
        "generated_reports",
        ["subject_author_id"],
    )
    op.create_index(
        "ix_generated_reports_saved_memory_id",
        "generated_reports",
        ["saved_memory_id"],
    )
    op.create_index(
        "ix_generated_reports_workspace_created",
        "generated_reports",
        ["workspace_id", "created_at"],
    )
    op.create_index(
        "ix_generated_reports_owner_created",
        "generated_reports",
        ["created_by_user_id", "created_at"],
    )

    op.create_table(
        "report_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("report_id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("author_id_at_generation", sa.Uuid(), nullable=False),
        sa.Column("memory_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["report_id"], ["generated_reports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id_at_generation"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_id", "memory_id", name="uq_report_sources_report_memory"),
    )
    op.create_index("ix_report_sources_report_id", "report_sources", ["report_id"])
    op.create_index("ix_report_sources_memory", "report_sources", ["memory_id"])

    op.create_table(
        "report_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("subject_author_id", sa.Uuid(), nullable=True),
        sa.Column("last_report_id", sa.Uuid(), nullable=True),
        sa.Column("preset", sa.String(length=32), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("topic", sa.String(length=500), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("cadence", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "preset IN ('MISSED', 'MEETING', 'ONBOARDING', 'HANDOVER', 'KNOWLEDGE_GAPS')",
            name="ck_report_subscriptions_preset",
        ),
        sa.CheckConstraint(
            "scope IN ('PERSONAL', 'MEMBER', 'WORKSPACE', 'PROJECT')",
            name="ck_report_subscriptions_scope",
        ),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_report_subscriptions_visibility",
        ),
        sa.CheckConstraint(
            "cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')",
            name="ck_report_subscriptions_cadence",
        ),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'PAUSED')",
            name="ck_report_subscriptions_status",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["last_report_id"],
            ["generated_reports.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_subscriptions_workspace_id", "report_subscriptions", ["workspace_id"]
    )
    op.create_index("ix_report_subscriptions_user_id", "report_subscriptions", ["user_id"])
    op.create_index("ix_report_subscriptions_next_run_at", "report_subscriptions", ["next_run_at"])
    op.create_index(
        "ix_report_subscriptions_due",
        "report_subscriptions",
        ["status", "next_run_at"],
    )
    op.create_index(
        "ix_report_subscriptions_user_created",
        "report_subscriptions",
        ["user_id", "created_at"],
    )

    op.create_table(
        "alignment_topics",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("evidence_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evidence_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'DECIDED', 'ARCHIVED')",
            name="ck_alignment_topics_status",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alignment_topics_workspace_id", "alignment_topics", ["workspace_id"])
    op.create_index(
        "ix_alignment_topics_created_by_user_id",
        "alignment_topics",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_alignment_topics_workspace_updated",
        "alignment_topics",
        ["workspace_id", "updated_at"],
    )

    op.create_table(
        "alignment_positions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('CANDIDATE', 'CONFIRMED', 'REVISED', 'WITHDRAWN', 'NO_RECORDED_POSITION')",
            name="ck_alignment_positions_status",
        ),
        sa.ForeignKeyConstraint(["topic_id"], ["alignment_topics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("topic_id", "user_id", name="uq_alignment_positions_topic_user"),
    )
    op.create_index("ix_alignment_positions_topic_id", "alignment_positions", ["topic_id"])
    op.create_index("ix_alignment_positions_user_id", "alignment_positions", ["user_id"])
    op.create_index(
        "ix_alignment_positions_topic_status",
        "alignment_positions",
        ["topic_id", "status"],
    )

    op.create_table(
        "alignment_position_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("position_id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["position_id"], ["alignment_positions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "position_id",
            "memory_id",
            name="uq_alignment_position_sources_position_memory",
        ),
    )
    op.create_index(
        "ix_alignment_position_sources_position_id",
        "alignment_position_sources",
        ["position_id"],
    )
    op.create_index(
        "ix_alignment_position_sources_memory",
        "alignment_position_sources",
        ["memory_id"],
    )

    op.create_table(
        "decision_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("published_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("supersedes_id", sa.Uuid(), nullable=True),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("alternatives", sa.JSON(), nullable=False),
        sa.Column("position_snapshot", sa.JSON(), nullable=False),
        sa.Column("review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["topic_id"], ["alignment_topics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["published_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["supersedes_id"], ["decision_records.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("memory_id"),
    )
    op.create_index("ix_decision_records_topic_id", "decision_records", ["topic_id"])
    op.create_index("ix_decision_records_workspace_id", "decision_records", ["workspace_id"])
    op.create_index("ix_decision_records_supersedes_id", "decision_records", ["supersedes_id"])
    op.create_index(
        "ix_decision_records_topic_created",
        "decision_records",
        ["topic_id", "created_at"],
    )
    op.create_index(
        "ix_decision_records_workspace_created",
        "decision_records",
        ["workspace_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_decision_records_workspace_created", table_name="decision_records")
    op.drop_index("ix_decision_records_topic_created", table_name="decision_records")
    op.drop_index("ix_decision_records_supersedes_id", table_name="decision_records")
    op.drop_index("ix_decision_records_workspace_id", table_name="decision_records")
    op.drop_index("ix_decision_records_topic_id", table_name="decision_records")
    op.drop_table("decision_records")
    op.drop_index("ix_alignment_position_sources_memory", table_name="alignment_position_sources")
    op.drop_index(
        "ix_alignment_position_sources_position_id",
        table_name="alignment_position_sources",
    )
    op.drop_table("alignment_position_sources")
    op.drop_index("ix_alignment_positions_topic_status", table_name="alignment_positions")
    op.drop_index("ix_alignment_positions_user_id", table_name="alignment_positions")
    op.drop_index("ix_alignment_positions_topic_id", table_name="alignment_positions")
    op.drop_table("alignment_positions")
    op.drop_index("ix_alignment_topics_workspace_updated", table_name="alignment_topics")
    op.drop_index("ix_alignment_topics_created_by_user_id", table_name="alignment_topics")
    op.drop_index("ix_alignment_topics_workspace_id", table_name="alignment_topics")
    op.drop_table("alignment_topics")
    op.drop_index("ix_report_subscriptions_user_created", table_name="report_subscriptions")
    op.drop_index("ix_report_subscriptions_due", table_name="report_subscriptions")
    op.drop_index("ix_report_subscriptions_next_run_at", table_name="report_subscriptions")
    op.drop_index("ix_report_subscriptions_user_id", table_name="report_subscriptions")
    op.drop_index("ix_report_subscriptions_workspace_id", table_name="report_subscriptions")
    op.drop_table("report_subscriptions")
    op.drop_index("ix_report_sources_memory", table_name="report_sources")
    op.drop_index("ix_report_sources_report_id", table_name="report_sources")
    op.drop_table("report_sources")
    op.drop_index("ix_generated_reports_owner_created", table_name="generated_reports")
    op.drop_index("ix_generated_reports_workspace_created", table_name="generated_reports")
    op.drop_index("ix_generated_reports_saved_memory_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_subject_author_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_created_by_user_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_workspace_id", table_name="generated_reports")
    op.drop_table("generated_reports")
