"""add single-use email verification challenges

Revision ID: 20260809_0022
Revises: 20260807_0021
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0022"
down_revision: str | Sequence[str] | None = "20260807_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_verification_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("code_digest", sa.String(length=64), nullable=False),
        sa.Column("attempts_remaining", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('REGISTER', 'LOGIN')",
            name="ck_email_verification_challenges_purpose",
        ),
        sa.CheckConstraint(
            "attempts_remaining >= 0",
            name="ck_email_verification_challenges_attempts_remaining",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verification_challenges_email",
        "email_verification_challenges",
        ["email"],
    )
    op.create_index(
        "ix_email_verification_challenges_expires_at",
        "email_verification_challenges",
        ["expires_at"],
    )
    op.create_index(
        "ix_email_verification_challenges_consumed_at",
        "email_verification_challenges",
        ["consumed_at"],
    )
    op.create_index(
        "ix_email_verification_challenges_email_purpose_created",
        "email_verification_challenges",
        ["email", "purpose", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_email_verification_challenges_email_purpose_created",
        table_name="email_verification_challenges",
    )
    op.drop_index(
        "ix_email_verification_challenges_consumed_at",
        table_name="email_verification_challenges",
    )
    op.drop_index(
        "ix_email_verification_challenges_expires_at",
        table_name="email_verification_challenges",
    )
    op.drop_index(
        "ix_email_verification_challenges_email",
        table_name="email_verification_challenges",
    )
    op.drop_table("email_verification_challenges")
