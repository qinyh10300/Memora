"""allow family workspaces to reuse collaborative membership rules

Revision ID: 20260807_0018
Revises: 20260807_0017
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0018"
down_revision: str | Sequence[str] | None = "20260807_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.drop_constraint("ck_workspaces_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_workspaces_kind",
            "kind IN ('PERSONAL', 'TEAM', 'FAMILY')",
        )


def downgrade() -> None:
    workspaces = sa.table("workspaces", sa.column("kind", sa.String(length=20)))
    family_count = op.get_bind().scalar(
        sa.select(sa.func.count()).select_from(workspaces).where(workspaces.c.kind == "FAMILY")
    )
    if family_count:
        raise RuntimeError("cannot downgrade while FAMILY workspaces exist")
    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.drop_constraint("ck_workspaces_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_workspaces_kind",
            "kind IN ('PERSONAL', 'TEAM')",
        )
