"""Reconcile schema metadata after Agent and document pipeline migrations.

Revision ID: 20260807_0016
Revises: 20260807_0015
Create Date: 2026-08-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260807_0016"
down_revision: str | None = "20260807_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The composite primary key already guarantees this event sequence uniqueness.
    op.drop_constraint("uq_agent_events_sequence", "agent_events", type_="unique")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'document_parse_jobs'::regclass
                  AND conname = 'document_parse_jobs_asset_id_key'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'document_parse_jobs'::regclass
                  AND conname = 'uq_document_parse_jobs_asset_id'
            ) THEN
                ALTER TABLE document_parse_jobs
                    RENAME CONSTRAINT document_parse_jobs_asset_id_key
                    TO uq_document_parse_jobs_asset_id;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'document_parse_jobs'::regclass
                  AND conname = 'uq_document_parse_jobs_asset_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'document_parse_jobs'::regclass
                  AND conname = 'document_parse_jobs_asset_id_key'
            ) THEN
                ALTER TABLE document_parse_jobs
                    RENAME CONSTRAINT uq_document_parse_jobs_asset_id
                    TO document_parse_jobs_asset_id_key;
            END IF;
        END $$;
        """
    )
    op.create_unique_constraint(
        "uq_agent_events_sequence",
        "agent_events",
        ["execution_id", "sequence"],
    )
