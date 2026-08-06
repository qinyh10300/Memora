"""add team join requests and memory title projection

Revision ID: 20260806_0012
Revises: 20260806_0011
Create Date: 2026-08-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260806_0012"
down_revision: str | None = "20260806_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _title_for(body: str) -> str | None:
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            line = line.lstrip("#").strip()
        return line[:240] or None
    return None


def upgrade() -> None:
    op.add_column("memories", sa.Column("title", sa.String(length=240), nullable=True))

    bind = op.get_bind()
    memories = sa.table(
        "memories",
        sa.column("id", sa.Uuid()),
        sa.column("body", sa.Text()),
        sa.column("title", sa.String(length=240)),
    )
    for memory_id, body in bind.execute(
        sa.select(memories.c.id, memories.c.body).where(memories.c.body.is_not(None))
    ):
        bind.execute(
            sa.update(memories).where(memories.c.id == memory_id).values(title=_title_for(body))
        )

    op.create_table(
        "workspace_join_requests",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="ck_workspace_join_requests_status",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", "user_id"),
    )
    op.create_index(
        "ix_workspace_join_requests_user_id",
        "workspace_join_requests",
        ["user_id"],
    )
    op.create_index(
        "ix_workspace_join_requests_reviewed_by_user_id",
        "workspace_join_requests",
        ["reviewed_by_user_id"],
    )
    op.create_index(
        "ix_workspace_join_requests_workspace_status",
        "workspace_join_requests",
        ["workspace_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workspace_join_requests_workspace_status",
        table_name="workspace_join_requests",
    )
    op.drop_index(
        "ix_workspace_join_requests_reviewed_by_user_id",
        table_name="workspace_join_requests",
    )
    op.drop_index(
        "ix_workspace_join_requests_user_id",
        table_name="workspace_join_requests",
    )
    op.drop_table("workspace_join_requests")
    op.drop_column("memories", "title")
