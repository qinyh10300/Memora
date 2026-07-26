"""add workspace kinds and persistent conversation shell

Revision ID: 20260726_0006
Revises: 20260722_0005
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260726_0006"
down_revision: str | None = "20260722_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "kind",
            sa.String(length=20),
            server_default=sa.text("'TEAM'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_workspaces_kind",
        "workspaces",
        "kind IN ('PERSONAL', 'TEAM')",
    )
    op.alter_column("workspaces", "kind", server_default=None)

    op.add_column("conversations", sa.Column("title", sa.String(length=120), nullable=True))
    op.execute(
        "UPDATE conversations "
        "SET title = CASE "
        "WHEN length(trim(topic)) > 0 THEN left(trim(topic), 120) "
        "ELSE '新对话' END"
    )
    op.alter_column("conversations", "title", nullable=False)
    op.add_column(
        "conversations",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute("UPDATE conversations SET updated_at = created_at")
    op.add_column(
        "conversations",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_conversations_updated_at",
        "conversations",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_conversations_archived_at",
        "conversations",
        ["archived_at"],
        unique=False,
    )
    op.create_index(
        "ix_conversations_workspace_user_updated",
        "conversations",
        ["workspace_id", "user_id", "updated_at"],
        unique=False,
    )

    op.add_column("messages", sa.Column("position", sa.Integer(), nullable=True))
    op.execute(
        "WITH ranked AS ("
        "SELECT id, CAST(row_number() OVER ("
        "PARTITION BY conversation_id "
        "ORDER BY created_at, CASE role WHEN 'USER' THEN 0 ELSE 1 END, id"
        ") - 1 AS integer) AS position "
        "FROM messages"
        ") "
        "UPDATE messages SET position = ranked.position FROM ranked "
        "WHERE messages.id = ranked.id"
    )
    op.alter_column("messages", "position", nullable=False)
    op.create_unique_constraint(
        "uq_messages_conversation_position",
        "messages",
        ["conversation_id", "position"],
    )

    op.add_column("messages", sa.Column("memory_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_messages_memory_id_memories",
        "messages",
        "memories",
        ["memory_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_messages_memory_id", "messages", ["memory_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_messages_memory_id", table_name="messages")
    op.drop_constraint("fk_messages_memory_id_memories", "messages", type_="foreignkey")
    op.drop_column("messages", "memory_id")
    op.drop_constraint("uq_messages_conversation_position", "messages", type_="unique")
    op.drop_column("messages", "position")

    op.drop_index("ix_conversations_workspace_user_updated", table_name="conversations")
    op.drop_index("ix_conversations_archived_at", table_name="conversations")
    op.drop_index("ix_conversations_updated_at", table_name="conversations")
    op.drop_column("conversations", "archived_at")
    op.drop_column("conversations", "updated_at")
    op.drop_column("conversations", "title")

    op.drop_constraint("ck_workspaces_kind", "workspaces", type_="check")
    op.drop_column("workspaces", "kind")
