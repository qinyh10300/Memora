"""add private and workspace knowledge diagrams

Revision ID: 20260807_0019
Revises: 20260807_0018
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0019"
down_revision: str | Sequence[str] | None = "20260807_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "diagrams",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("edges", sa.JSON(), nullable=False),
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
            "kind IN ('MIND_MAP', 'FLOWCHART')",
            name="ck_diagrams_kind",
        ),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'WORKSPACE')",
            name="ck_diagrams_visibility",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diagrams_owner_id", "diagrams", ["owner_id"])
    op.create_index("ix_diagrams_owner_updated", "diagrams", ["owner_id", "updated_at"])
    op.create_index("ix_diagrams_workspace_id", "diagrams", ["workspace_id"])
    op.create_index(
        "ix_diagrams_workspace_updated",
        "diagrams",
        ["workspace_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_diagrams_workspace_updated", table_name="diagrams")
    op.drop_index("ix_diagrams_workspace_id", table_name="diagrams")
    op.drop_index("ix_diagrams_owner_updated", table_name="diagrams")
    op.drop_index("ix_diagrams_owner_id", table_name="diagrams")
    op.drop_table("diagrams")
