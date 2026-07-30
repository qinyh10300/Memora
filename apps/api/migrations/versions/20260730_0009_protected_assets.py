"""add protected Markdown and attachment assets

Revision ID: 20260730_0009
Revises: 20260726_0008
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0009"
down_revision: str | None = "20260726_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("content_type", sa.String(length=80), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('IMAGE', 'PDF')", name="ck_assets_kind"),
        sa.CheckConstraint("size_bytes > 0", name="ck_assets_size_positive"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assets_workspace_id", "assets", ["workspace_id"], unique=False)
    op.create_index("ix_assets_owner_id", "assets", ["owner_id"], unique=False)
    op.create_index("ix_assets_deleted_at", "assets", ["deleted_at"], unique=False)
    op.create_index(
        "ix_assets_workspace_owner_created_at",
        "assets",
        ["workspace_id", "owner_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_assets_workspace_deleted_at",
        "assets",
        ["workspace_id", "deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_assets_workspace_deleted_at", table_name="assets")
    op.drop_index("ix_assets_workspace_owner_created_at", table_name="assets")
    op.drop_index("ix_assets_deleted_at", table_name="assets")
    op.drop_index("ix_assets_owner_id", table_name="assets")
    op.drop_index("ix_assets_workspace_id", table_name="assets")
    op.drop_table("assets")
