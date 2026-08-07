"""add PostgreSQL full-text and trigram retrieval indexes

Revision ID: 20260807_0013
Revises: 20260806_0012
Create Date: 2026-08-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260807_0013"
down_revision: str | None = "20260806_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_memories_active_search_vector
            ON memories USING gin (
              (
                setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
                setweight(to_tsvector('simple'::regconfig, coalesce(body, '')), 'B')
              )
            )
            WHERE deleted_at IS NULL AND timeline_visible IS TRUE
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_memories_active_title_trgm
            ON memories USING gin (title gin_trgm_ops)
            WHERE deleted_at IS NULL AND timeline_visible IS TRUE
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_memories_active_body_trgm
            ON memories USING gin (body gin_trgm_ops)
            WHERE deleted_at IS NULL AND timeline_visible IS TRUE
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_memories_active_body_trgm")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_memories_active_title_trgm")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_memories_active_search_vector")
    # pg_trgm can be shared by other schemas or applications. Keep the extension on downgrade.
