"""record model and token usage on audit events

Revision ID: 20260726_0008
Revises: 20260726_0007
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260726_0008"
down_revision: str | None = "20260726_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("audit_events", sa.Column("model", sa.String(length=160), nullable=True))
    op.add_column(
        "audit_events",
        sa.Column(
            "input_tokens",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "audit_events",
        sa.Column(
            "output_tokens",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.alter_column("audit_events", "input_tokens", server_default=None)
    op.alter_column("audit_events", "output_tokens", server_default=None)
    op.create_check_constraint(
        "ck_audit_events_token_usage",
        "audit_events",
        "input_tokens >= 0 AND output_tokens >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_audit_events_token_usage", "audit_events", type_="check")
    op.drop_column("audit_events", "output_tokens")
    op.drop_column("audit_events", "input_tokens")
    op.drop_column("audit_events", "model")
