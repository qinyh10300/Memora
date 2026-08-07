#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR=${BACKUP_DIR:-"$ROOT_DIR/artifacts/backups"}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
RETENTION_COUNT=${BACKUP_RETENTION_COUNT:-14}
PREFIX=${BACKUP_PREFIX:-memora}

usage() {
  echo "Usage: $0 [--output-dir DIR] [--retention-days DAYS] [--retention-count COUNT]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      OUTPUT_DIR=$2
      shift 2
      ;;
    --retention-days)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      RETENTION_DAYS=$2
      shift 2
      ;;
    --retention-count)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      RETENTION_COUNT=$2
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

case "$RETENTION_DAYS:$RETENTION_COUNT" in
  *[!0-9:]*|:*|*:|0:*|*:0)
    echo "Retention days and count must be positive integers" >&2
    exit 2
    ;;
esac
case "$PREFIX" in
  *[!A-Za-z0-9._-]*|'')
    echo "Backup prefix may only contain letters, digits, dots, underscores, and dashes" >&2
    exit 2
    ;;
esac

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

remove_bundle() {
  dump_path=$1
  rm -f -- "$dump_path" "$dump_path.sha256" "$dump_path.json"
}

cd "$ROOT_DIR"
if ! docker compose ps --services --status running | grep -qx db; then
  echo "Memora database service is not running; start it with 'make db' first" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
OUTPUT_DIR=$(CDPATH= cd -- "$OUTPUT_DIR" && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BACKUP_PATH="$OUTPUT_DIR/$PREFIX-$STAMP.dump"
TMP_PATH="$OUTPUT_DIR/.$PREFIX-$STAMP.dump.tmp"
trap 'rm -f -- "$TMP_PATH"' EXIT INT TERM

echo "Creating a consistent PostgreSQL archive..." >&2
docker compose exec -T db sh -ec \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-privileges' \
  >"$TMP_PATH"
docker compose exec -T db pg_restore --list <"$TMP_PATH" >/dev/null

REVISION=$(docker compose exec -T db sh -ec \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT version_num FROM alembic_version LIMIT 1"' \
  | tr -d '[:space:]')
[ -n "$REVISION" ] || { echo "Database has no Alembic revision" >&2; exit 1; }

mv "$TMP_PATH" "$BACKUP_PATH"
chmod 600 "$BACKUP_PATH"
DIGEST=$(sha256_file "$BACKUP_PATH")
SIZE_BYTES=$(wc -c <"$BACKUP_PATH" | tr -d '[:space:]')
printf '%s  %s\n' "$DIGEST" "$(basename -- "$BACKUP_PATH")" >"$BACKUP_PATH.sha256"
printf '{\n  "format": "postgresql-custom",\n  "created_at": "%s",\n  "file": "%s",\n  "size_bytes": %s,\n  "sha256": "%s",\n  "alembic_revision": "%s",\n  "data_classification": "restricted",\n  "contains_protected_user_content": true,\n  "offsite_encryption_required": true\n}\n' \
  "$CREATED_AT" "$(basename -- "$BACKUP_PATH")" "$SIZE_BYTES" "$DIGEST" "$REVISION" \
  >"$BACKUP_PATH.json"
chmod 600 "$BACKUP_PATH.sha256" "$BACKUP_PATH.json"

find "$OUTPUT_DIR" -type f -name "$PREFIX-*.dump" -mtime "+$RETENTION_DAYS" -print |
  while IFS= read -r old_dump; do
    [ -n "$old_dump" ] && remove_bundle "$old_dump"
  done

ls -1t "$OUTPUT_DIR"/$PREFIX-*.dump 2>/dev/null | awk "NR > $RETENTION_COUNT" |
  while IFS= read -r old_dump; do
    [ -n "$old_dump" ] && remove_bundle "$old_dump"
  done

echo "Backup verified: $BACKUP_PATH ($SIZE_BYTES bytes, revision $REVISION)" >&2
printf '%s\n' "$BACKUP_PATH"
