"""add join codes for team workspaces

Revision ID: 20260806_0011
Revises: 20260806_0010
Create Date: 2026-08-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260806_0011"
down_revision: str | None = "20260806_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("join_code", sa.String(length=12), nullable=True),
    )
    op.execute(
        "UPDATE workspaces "
        "SET join_code = upper(substr(md5(CAST(id AS text) || slug), 1, 12)) "
        "WHERE kind = 'TEAM' AND join_code IS NULL"
    )
    op.create_index(
        "ix_workspaces_join_code",
        "workspaces",
        ["join_code"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_workspaces_join_code", table_name="workspaces")
    op.drop_column("workspaces", "join_code")
