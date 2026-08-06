"""add protected user profile avatars

Revision ID: 20260806_0010
Revises: 20260730_0009
Create Date: 2026-08-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260806_0010"
down_revision: str | None = "20260730_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_asset_id", sa.Uuid(), nullable=True))
    op.create_index("ix_users_avatar_asset_id", "users", ["avatar_asset_id"], unique=False)
    op.create_foreign_key(
        "fk_users_avatar_asset_id_assets",
        "users",
        "assets",
        ["avatar_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_avatar_asset_id_assets", "users", type_="foreignkey")
    op.drop_index("ix_users_avatar_asset_id", table_name="users")
    op.drop_column("users", "avatar_asset_id")
