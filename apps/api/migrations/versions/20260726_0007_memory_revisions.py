"""add immutable memory revision metadata

Revision ID: 20260726_0007
Revises: 20260726_0006
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260726_0007"
down_revision: str | None = "20260726_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memories", sa.Column("timeline_entry_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE memories SET timeline_entry_id = id")
    op.alter_column("memories", "timeline_entry_id", nullable=False)

    op.add_column(
        "memories",
        sa.Column(
            "timeline_visible",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.alter_column("memories", "timeline_visible", server_default=None)
    op.add_column(
        "memories",
        sa.Column(
            "revision_kind",
            sa.String(length=20),
            server_default=sa.text("'ROOT'"),
            nullable=False,
        ),
    )
    op.alter_column("memories", "revision_kind", server_default=None)
    op.create_check_constraint(
        "ck_memories_revision_kind",
        "memories",
        "revision_kind IN ('ROOT', 'UPDATE_CURRENT', 'NEW_VERSION')",
    )
    op.create_index(
        "ix_memories_timeline_entry_id",
        "memories",
        ["timeline_entry_id"],
        unique=False,
    )
    op.create_index(
        "ix_memories_timeline_visible",
        "memories",
        ["timeline_visible"],
        unique=False,
    )
    op.create_index(
        "ix_memories_timeline_entry_created_at",
        "memories",
        ["timeline_entry_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_memories_timeline_entry_created_at", table_name="memories")
    op.drop_index("ix_memories_timeline_visible", table_name="memories")
    op.drop_index("ix_memories_timeline_entry_id", table_name="memories")
    op.drop_constraint("ck_memories_revision_kind", "memories", type_="check")
    op.drop_column("memories", "revision_kind")
    op.drop_column("memories", "timeline_visible")
    op.drop_column("memories", "timeline_entry_id")
