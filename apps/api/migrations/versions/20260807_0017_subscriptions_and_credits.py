"""add subscriptions and append-only credit ledger

Revision ID: 20260807_0017
Revises: 20260807_0016
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260807_0017"
down_revision: str | Sequence[str] | None = "20260807_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("plan_code", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("period_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("credits_granted", sa.BigInteger(), nullable=False),
        sa.Column("credits_used", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
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
            "plan_code IN ('PLUS', 'PRO', 'ULTRA')",
            name="ck_subscriptions_plan_code",
        ),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED')",
            name="ck_subscriptions_status",
        ),
        sa.CheckConstraint(
            "credits_granted >= 0 AND credits_used >= 0 AND credits_used <= credits_granted",
            name="ck_subscriptions_credit_bounds",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "ix_subscriptions_period_ends_at",
        "subscriptions",
        ["period_ends_at"],
        unique=False,
    )
    op.create_table(
        "credit_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("delta", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("reference_type", sa.String(length=40), nullable=True),
        sa.Column("reference_id", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "balance_after >= 0",
            name="ck_credit_ledger_balance_nonnegative",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_credit_ledger_user_idempotency",
        ),
    )
    op.create_index(
        "ix_credit_ledger_entries_user_id",
        "credit_ledger_entries",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_credit_ledger_user_created",
        "credit_ledger_entries",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_credit_ledger_user_created", table_name="credit_ledger_entries")
    op.drop_index("ix_credit_ledger_entries_user_id", table_name="credit_ledger_entries")
    op.drop_table("credit_ledger_entries")
    op.drop_index("ix_subscriptions_period_ends_at", table_name="subscriptions")
    op.drop_table("subscriptions")
