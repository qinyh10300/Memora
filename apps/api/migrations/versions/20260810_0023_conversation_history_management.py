"""add persistent conversation pinning

Revision ID: 20260810_0023
Revises: 20260809_0022
Create Date: 2026-08-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260810_0023"
down_revision: str | Sequence[str] | None = "20260809_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_conversations_pinned_at",
        "conversations",
        ["pinned_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_conversations_pinned_at", table_name="conversations")
    op.drop_column("conversations", "pinned_at")
