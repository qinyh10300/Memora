#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONTAINER_NAME="memora-retrieval-eval-$$"
POSTGRES_PASSWORD="memora-evaluation-only"
POSTGRES_IMAGE="${MEMORA_EVAL_POSTGRES_IMAGE:-pgvector/pgvector:pg17}"

cleanup() {
  docker rm --force --volumes "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach \
  --name "$CONTAINER_NAME" \
  --env POSTGRES_DB=memora_eval \
  --env POSTGRES_USER=memora_eval \
  --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --publish 127.0.0.1::5432 \
  "$POSTGRES_IMAGE" >/dev/null

attempt=0
until docker exec "$CONTAINER_NAME" pg_isready --username memora_eval --dbname memora_eval >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "PostgreSQL evaluation database did not become ready" >&2
    exit 1
  fi
  sleep 1
done

PORT=$(docker port "$CONTAINER_NAME" 5432/tcp | sed -n '1s/.*://p')
DATABASE_URL="postgresql+psycopg://memora_eval:${POSTGRES_PASSWORD}@127.0.0.1:${PORT}/memora_eval"

cd "$ROOT_DIR/apps/api"
DATABASE_URL="$DATABASE_URL" uv run alembic upgrade head >/dev/null
DATABASE_URL="$DATABASE_URL" uv run alembic check
DATABASE_URL="$DATABASE_URL" uv run python "$ROOT_DIR/scripts/check-postgres-error-redaction.py"
uv run python -m memora.retrieval.postgres_evaluation \
  --database-url "$DATABASE_URL" \
  --dataset evaluation/retrieval/v1.json \
  "$@"

DATABASE_URL="$DATABASE_URL" uv run alembic downgrade 20260806_0012 >/dev/null
DATABASE_URL="$DATABASE_URL" uv run alembic upgrade head >/dev/null
DATABASE_URL="$DATABASE_URL" uv run alembic check

INDEX_COUNT=$(
  docker exec "$CONTAINER_NAME" psql \
    --username memora_eval \
    --dbname memora_eval \
    --tuples-only \
    --no-align \
    --command "
      SELECT count(*)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN (
        'ix_memories_active_search_vector',
        'ix_memories_active_title_trgm',
        'ix_memories_active_body_trgm'
      )
        AND i.indisready
        AND i.indisvalid;
    "
)
if [ "$INDEX_COUNT" != "3" ]; then
  echo "Expected three ready and valid concurrent retrieval indexes, got $INDEX_COUNT" >&2
  exit 1
fi
