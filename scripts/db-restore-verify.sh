#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
POSTGRES_IMAGE=${MEMORA_RESTORE_POSTGRES_IMAGE:-pgvector/pgvector:pg17}
CONTAINER_NAME="memora-restore-verify-$$"
VOLUME_NAME="$CONTAINER_NAME-data"
POSTGRES_USER=memora_restore
POSTGRES_DB=memora_restore
POSTGRES_PASSWORD=memora-restore-verification-only
EXPECTED_REVISION=${EXPECTED_ALEMBIC_REVISION:-}
REPORT_PATH=
KEEP_RESTORE_DB=${KEEP_RESTORE_DB:-0}

usage() {
  echo "Usage: $0 BACKUP.dump [--expected-revision REVISION] [--report PATH]" >&2
}

[ "$#" -ge 1 ] || { usage; exit 2; }
BACKUP_PATH=$1
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expected-revision)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      EXPECTED_REVISION=$2
      shift 2
      ;;
    --report)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      REPORT_PATH=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$BACKUP_PATH" in
  /*) ;;
  *) BACKUP_PATH="$PWD/$BACKUP_PATH" ;;
esac
[ -f "$BACKUP_PATH" ] || { echo "Backup not found: $BACKUP_PATH" >&2; exit 1; }
[ -f "$BACKUP_PATH.sha256" ] || { echo "Checksum sidecar not found: $BACKUP_PATH.sha256" >&2; exit 1; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

cleanup() {
  if [ "$KEEP_RESTORE_DB" = "1" ]; then
    echo "Restore database retained in container $CONTAINER_NAME" >&2
    return
  fi
  docker rm --force --volumes "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

EXPECTED_DIGEST=$(awk 'NR == 1 {print $1}' "$BACKUP_PATH.sha256")
ACTUAL_DIGEST=$(sha256_file "$BACKUP_PATH")
[ "$EXPECTED_DIGEST" = "$ACTUAL_DIGEST" ] || {
  echo "Backup checksum mismatch" >&2
  exit 1
}

if [ -z "$EXPECTED_REVISION" ] && command -v uv >/dev/null 2>&1; then
  EXPECTED_REVISION=$(cd "$ROOT_DIR/apps/api" && uv run alembic heads | awk 'NR == 1 {print $1}')
fi
if [ -z "$EXPECTED_REVISION" ] && [ -f "$BACKUP_PATH.json" ]; then
  EXPECTED_REVISION=$(sed -n 's/.*"alembic_revision": "\([^"]*\)".*/\1/p' "$BACKUP_PATH.json")
fi
[ -n "$EXPECTED_REVISION" ] || {
  echo "Unable to determine the expected Alembic revision" >&2
  exit 1
}

docker run --rm --interactive --entrypoint pg_restore "$POSTGRES_IMAGE" --list \
  <"$BACKUP_PATH" >/dev/null
docker volume create "$VOLUME_NAME" >/dev/null
docker run --detach \
  --name "$CONTAINER_NAME" \
  --env POSTGRES_DB="$POSTGRES_DB" \
  --env POSTGRES_USER="$POSTGRES_USER" \
  --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --volume "$VOLUME_NAME:/var/lib/postgresql/data" \
  "$POSTGRES_IMAGE" >/dev/null

attempt=0
until docker exec "$CONTAINER_NAME" pg_isready --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    docker logs "$CONTAINER_NAME" >&2
    echo "Isolated restore database did not become ready" >&2
    exit 1
  fi
  sleep 1
done

echo "Restoring archive into isolated PostgreSQL..." >&2
docker exec --interactive "$CONTAINER_NAME" pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  <"$BACKUP_PATH" >/dev/null

query() {
  docker exec "$CONTAINER_NAME" psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "$1" | tr -d '[:space:]'
}

assert_at_least() {
  label=$1
  actual=$2
  minimum=$3
  if [ "$actual" -lt "$minimum" ]; then
    echo "$label count $actual is below required minimum $minimum" >&2
    exit 1
  fi
}

REVISION=$(query 'SELECT version_num FROM alembic_version LIMIT 1')
[ "$REVISION" = "$EXPECTED_REVISION" ] || {
  echo "Alembic revision mismatch: restored=$REVISION expected=$EXPECTED_REVISION" >&2
  exit 1
}

USERS=$(query 'SELECT count(*) FROM users')
WORKSPACES=$(query 'SELECT count(*) FROM workspaces')
MEMORIES=$(query 'SELECT count(*) FROM memories')
ASSETS=$(query 'SELECT count(*) FROM assets')
CITATIONS=$(query 'SELECT count(*) FROM memory_document_citations')
ASSET_DECLARED_BYTES=$(query 'SELECT COALESCE(sum(size_bytes), 0) FROM assets')
ASSET_STORED_BYTES=$(query 'SELECT COALESCE(sum(octet_length(content)), 0) FROM assets')
ORPHAN_CITATIONS=$(query 'SELECT count(*) FROM memory_document_citations c LEFT JOIN memories m ON m.id = c.memory_id LEFT JOIN assets a ON a.id = c.asset_id LEFT JOIN document_chunks d ON d.id = c.chunk_id WHERE m.id IS NULL OR a.id IS NULL OR (c.chunk_id IS NOT NULL AND d.id IS NULL)')

assert_at_least users "$USERS" "${VERIFY_MIN_USERS:-1}"
assert_at_least workspaces "$WORKSPACES" "${VERIFY_MIN_WORKSPACES:-1}"
assert_at_least memories "$MEMORIES" "${VERIFY_MIN_MEMORIES:-0}"
assert_at_least assets "$ASSETS" "${VERIFY_MIN_ASSETS:-0}"
assert_at_least citations "$CITATIONS" "${VERIFY_MIN_CITATIONS:-0}"
[ "$ASSET_DECLARED_BYTES" = "$ASSET_STORED_BYTES" ] || {
  echo "Asset byte mismatch: declared=$ASSET_DECLARED_BYTES stored=$ASSET_STORED_BYTES" >&2
  exit 1
}
[ "$ORPHAN_CITATIONS" -eq 0 ] || {
  echo "Restored database contains $ORPHAN_CITATIONS orphan document citations" >&2
  exit 1
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -z "$REPORT_PATH" ]; then
  REPORT_PATH="$ROOT_DIR/artifacts/restore-verification-$STAMP.json"
fi
case "$REPORT_PATH" in
  /*) ;;
  *) REPORT_PATH="$PWD/$REPORT_PATH" ;;
esac
mkdir -p "$(dirname -- "$REPORT_PATH")"
printf '{\n  "verified_at": "%s",\n  "backup_file": "%s",\n  "sha256": "%s",\n  "alembic_revision": "%s",\n  "counts": {\n    "users": %s,\n    "workspaces": %s,\n    "memories": %s,\n    "assets": %s,\n    "citations": %s\n  },\n  "asset_bytes": %s,\n  "orphan_citations": %s,\n  "status": "passed"\n}\n' \
  "$VERIFIED_AT" "$(basename -- "$BACKUP_PATH")" "$ACTUAL_DIGEST" "$REVISION" \
  "$USERS" "$WORKSPACES" "$MEMORIES" "$ASSETS" "$CITATIONS" \
  "$ASSET_STORED_BYTES" "$ORPHAN_CITATIONS" >"$REPORT_PATH"
chmod 600 "$REPORT_PATH"

echo "Restore verification passed: revision $REVISION, users $USERS, workspaces $WORKSPACES, memories $MEMORIES, assets $ASSETS, citations $CITATIONS" >&2
printf '%s\n' "$REPORT_PATH"
