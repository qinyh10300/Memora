"""add AI visual jobs and credit reservations

Revision ID: 20260807_0020
Revises: 20260807_0019
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0020"
down_revision: str | Sequence[str] | None = "20260807_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_diagrams_kind", "diagrams", type_="check")
    op.create_check_constraint(
        "ck_diagrams_kind",
        "diagrams",
        "kind IN ('MIND_MAP', 'FLOWCHART', 'TIMELINE')",
    )
    op.drop_constraint("ck_subscriptions_credit_bounds", "subscriptions", type_="check")
    op.add_column(
        "subscriptions",
        sa.Column("credits_reserved", sa.BigInteger(), server_default="0", nullable=False),
    )
    op.create_check_constraint(
        "ck_subscriptions_credit_bounds",
        "subscriptions",
        "credits_granted >= 0 AND credits_used >= 0 AND credits_reserved >= 0 "
        "AND credits_used + credits_reserved <= credits_granted",
    )

    op.create_table(
        "credit_reservations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("reference_type", sa.String(length=40), nullable=False),
        sa.Column("reference_id", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_credit_reservations_amount_positive"),
        sa.CheckConstraint(
            "status IN ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED')",
            name="ck_credit_reservations_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_credit_reservations_user_idempotency",
        ),
    )
    op.create_index("ix_credit_reservations_user_id", "credit_reservations", ["user_id"])
    op.create_index(
        "ix_credit_reservations_user_status",
        "credit_reservations",
        ["user_id", "status"],
    )
    op.create_index(
        "ix_credit_reservations_expiry",
        "credit_reservations",
        ["status", "expires_at"],
    )

    op.create_table(
        "visual_projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
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
        sa.CheckConstraint("mode IN ('STRUCTURED', 'IMAGE')", name="ck_visual_projects_mode"),
        sa.CheckConstraint(
            "kind IN ('SCIENTIFIC', 'MIND_MAP', 'FLOWCHART', 'TIMELINE')",
            name="ck_visual_projects_kind",
        ),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_visual_projects_visibility",
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'QUEUED', 'GENERATING', 'WAITING_CONFIRMATION', "
            "'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_visual_projects_status",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visual_projects_owner_id", "visual_projects", ["owner_id"])
    op.create_index(
        "ix_visual_projects_owner_updated",
        "visual_projects",
        ["owner_id", "updated_at"],
    )
    op.create_index("ix_visual_projects_workspace_id", "visual_projects", ["workspace_id"])
    op.create_index(
        "ix_visual_projects_workspace_updated",
        "visual_projects",
        ["workspace_id", "updated_at"],
    )

    op.create_table(
        "visual_generation_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("provider_model", sa.String(length=120), nullable=False),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("credit_cost", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "next_run_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'WAITING_CONFIGURATION', "
            "'WAITING_CONFIRMATION', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_visual_jobs_status",
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_visual_jobs_progress"),
        sa.CheckConstraint("credit_cost > 0", name="ck_visual_jobs_credit_cost"),
        sa.ForeignKeyConstraint(["project_id"], ["visual_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["reservation_id"], ["credit_reservations.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reservation_id"),
    )
    op.create_index("ix_visual_jobs_project_id", "visual_generation_jobs", ["project_id"])
    op.create_index("ix_visual_jobs_workspace_id", "visual_generation_jobs", ["workspace_id"])
    op.create_index(
        "ix_visual_jobs_requested_by_user_id",
        "visual_generation_jobs",
        ["requested_by_user_id"],
    )
    op.create_index("ix_visual_jobs_locked_at", "visual_generation_jobs", ["locked_at"])
    op.create_index(
        "ix_visual_jobs_claim",
        "visual_generation_jobs",
        ["status", "next_run_at", "created_at"],
    )
    op.create_index(
        "ix_visual_jobs_project_created",
        "visual_generation_jobs",
        ["project_id", "created_at"],
    )

    op.create_table(
        "visual_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("provider_model", sa.String(length=120), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("revised_prompt", sa.Text(), nullable=True),
        sa.Column("graph", sa.JSON(), nullable=True),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("diagram_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("version_number > 0", name="ck_visual_versions_number_positive"),
        sa.CheckConstraint(
            "status IN ('CANDIDATE', 'CONFIRMED')",
            name="ck_visual_versions_status",
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["diagram_id"], ["diagrams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["visual_generation_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["visual_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "version_number",
            name="uq_visual_versions_project_number",
        ),
    )
    op.create_index("ix_visual_versions_project_id", "visual_versions", ["project_id"])
    op.create_index("ix_visual_versions_job_id", "visual_versions", ["job_id"])
    op.create_index("ix_visual_versions_asset_id", "visual_versions", ["asset_id"])
    op.create_index("ix_visual_versions_diagram_id", "visual_versions", ["diagram_id"])
    op.create_index(
        "ix_visual_versions_project_created",
        "visual_versions",
        ["project_id", "created_at"],
    )

    op.create_table(
        "visual_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=True),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["job_id"], ["visual_generation_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["visual_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "memory_id", name="uq_visual_sources_job_memory"),
    )
    op.create_index("ix_visual_sources_job_id", "visual_sources", ["job_id"])
    op.create_index("ix_visual_sources_memory", "visual_sources", ["memory_id"])
    op.create_index("ix_visual_sources_version", "visual_sources", ["version_id"])


def downgrade() -> None:
    op.drop_index("ix_visual_sources_version", table_name="visual_sources")
    op.drop_index("ix_visual_sources_memory", table_name="visual_sources")
    op.drop_index("ix_visual_sources_job_id", table_name="visual_sources")
    op.drop_table("visual_sources")
    op.drop_index("ix_visual_versions_project_created", table_name="visual_versions")
    op.drop_index("ix_visual_versions_job_id", table_name="visual_versions")
    op.drop_index("ix_visual_versions_diagram_id", table_name="visual_versions")
    op.drop_index("ix_visual_versions_asset_id", table_name="visual_versions")
    op.drop_index("ix_visual_versions_project_id", table_name="visual_versions")
    op.drop_table("visual_versions")
    op.drop_index("ix_visual_jobs_project_created", table_name="visual_generation_jobs")
    op.drop_index("ix_visual_jobs_claim", table_name="visual_generation_jobs")
    op.drop_index("ix_visual_jobs_locked_at", table_name="visual_generation_jobs")
    op.drop_index("ix_visual_jobs_requested_by_user_id", table_name="visual_generation_jobs")
    op.drop_index("ix_visual_jobs_workspace_id", table_name="visual_generation_jobs")
    op.drop_index("ix_visual_jobs_project_id", table_name="visual_generation_jobs")
    op.drop_table("visual_generation_jobs")
    op.drop_index("ix_visual_projects_workspace_updated", table_name="visual_projects")
    op.drop_index("ix_visual_projects_workspace_id", table_name="visual_projects")
    op.drop_index("ix_visual_projects_owner_updated", table_name="visual_projects")
    op.drop_index("ix_visual_projects_owner_id", table_name="visual_projects")
    op.drop_table("visual_projects")
    op.drop_index("ix_credit_reservations_expiry", table_name="credit_reservations")
    op.drop_index("ix_credit_reservations_user_status", table_name="credit_reservations")
    op.drop_index("ix_credit_reservations_user_id", table_name="credit_reservations")
    op.drop_table("credit_reservations")
    op.drop_constraint("ck_subscriptions_credit_bounds", "subscriptions", type_="check")
    op.drop_column("subscriptions", "credits_reserved")
    op.create_check_constraint(
        "ck_subscriptions_credit_bounds",
        "subscriptions",
        "credits_granted >= 0 AND credits_used >= 0 AND credits_used <= credits_granted",
    )
    op.drop_constraint("ck_diagrams_kind", "diagrams", type_="check")
    op.create_check_constraint(
        "ck_diagrams_kind",
        "diagrams",
        "kind IN ('MIND_MAP', 'FLOWCHART')",
    )
