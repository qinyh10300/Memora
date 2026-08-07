#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
API_IMAGE=${ROLLBACK_API_IMAGE:-}
WORKER_IMAGE=${ROLLBACK_WORKER_IMAGE:-}
WEB_IMAGE=${ROLLBACK_WEB_IMAGE:-}
SMOKE_EMAIL=${ROLLBACK_SMOKE_EMAIL:-browser-owner@memora.local}
SMOKE_PASSWORD=${ROLLBACK_SMOKE_PASSWORD:-browser-owner-password}
REPORT_PATH=${ROLLBACK_REPORT_PATH:-"$ROOT_DIR/artifacts/application-rollback-drill.json"}
PREFIX="memora-rollback-$$"
NETWORK="$PREFIX-network"
VOLUME="$PREFIX-data"
DB="$PREFIX-db"
API="$PREFIX-api"
WORKER="$PREFIX-worker"
WEB="$PREFIX-web"
PROXY="$PREFIX-proxy"

usage() {
  echo "Usage: ROLLBACK_API_IMAGE=... ROLLBACK_WORKER_IMAGE=... ROLLBACK_WEB_IMAGE=... $0 BACKUP.dump" >&2
}

[ "$#" -eq 1 ] || { usage; exit 2; }
[ -n "$API_IMAGE" ] && [ -n "$WORKER_IMAGE" ] && [ -n "$WEB_IMAGE" ] || {
  usage
  exit 2
}
BACKUP_PATH=$1
case "$BACKUP_PATH" in
  /*) ;;
  *) BACKUP_PATH="$PWD/$BACKUP_PATH" ;;
esac
[ -f "$BACKUP_PATH" ] || { echo "Backup not found: $BACKUP_PATH" >&2; exit 1; }

cleanup() {
  docker rm --force --volumes "$PROXY" "$WEB" "$WORKER" "$API" "$DB" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for image in "$API_IMAGE" "$WORKER_IMAGE" "$WEB_IMAGE"; do
  docker image inspect "$image" >/dev/null
done
API_DIGEST=$(docker image inspect "$API_IMAGE" --format '{{.Id}}')
WORKER_DIGEST=$(docker image inspect "$WORKER_IMAGE" --format '{{.Id}}')
WEB_DIGEST=$(docker image inspect "$WEB_IMAGE" --format '{{.Id}}')

docker network create "$NETWORK" >/dev/null
docker volume create "$VOLUME" >/dev/null
docker run --detach \
  --name "$DB" \
  --network "$NETWORK" \
  --network-alias db \
  --env POSTGRES_DB=memora \
  --env POSTGRES_USER=memora \
  --env POSTGRES_PASSWORD=memora-rollback-only \
  --volume "$VOLUME:/var/lib/postgresql/data" \
  pgvector/pgvector:pg17 >/dev/null

attempt=0
until docker exec "$DB" pg_isready --username memora --dbname memora >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    docker logs "$DB" >&2
    exit 1
  fi
  sleep 1
done
docker exec --interactive "$DB" pg_restore \
  --username memora \
  --dbname memora \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  <"$BACKUP_PATH" >/dev/null
REVISION_BEFORE=$(docker exec "$DB" psql --username memora --dbname memora --tuples-only --no-align \
  --command 'SELECT version_num FROM alembic_version LIMIT 1' | tr -d '[:space:]')

COMMON_DATABASE_URL=postgresql+psycopg://memora:memora-rollback-only@db:5432/memora
docker run --detach \
  --name "$API" \
  --network "$NETWORK" \
  --network-alias api \
  --env APP_ENV=development \
  --env DATABASE_URL="$COMMON_DATABASE_URL" \
  --env SESSION_SECRET=rollback-drill-session-secret-only \
  --env AI_CHAT_API_KEY= \
  --env AI_EMBEDDING_API_KEY= \
  "$API_IMAGE" >/dev/null
docker run --detach \
  --name "$WORKER" \
  --network "$NETWORK" \
  --env APP_ENV=development \
  --env DATABASE_URL="$COMMON_DATABASE_URL" \
  --env SESSION_SECRET=rollback-drill-session-secret-only \
  --env AI_CHAT_API_KEY= \
  --env AI_EMBEDDING_API_KEY= \
  "$WORKER_IMAGE" uv run --no-sync memora-worker --interval 5 >/dev/null
docker run --detach \
  --name "$WEB" \
  --network "$NETWORK" \
  --network-alias web \
  "$WEB_IMAGE" >/dev/null
docker run --detach \
  --name "$PROXY" \
  --network "$NETWORK" \
  --publish 127.0.0.1::80 \
  --env CADDY_SITE_ADDRESS=http://localhost \
  --volume "$ROOT_DIR/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine >/dev/null

attempt=0
until docker exec "$API" python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=2)" \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    docker logs "$API" >&2
    exit 1
  fi
  sleep 1
done
docker exec "$WEB" node -e \
  "fetch('http://127.0.0.1:3000/health').then(r => { if (!r.ok) process.exit(1) })" >/dev/null
sleep 2
[ "$(docker inspect "$WORKER" --format '{{.State.Running}}')" = true ] || {
  docker logs "$WORKER" >&2
  exit 1
}

PORT=$(docker port "$PROXY" 80/tcp | sed -n '1s/.*://p')
PUBLIC_URL="http://localhost:$PORT"
attempt=0
until docker exec "$PROXY" wget -q -O - http://web:3000/health >/dev/null 2>&1 \
  && python3 -c "import urllib.request; opener = urllib.request.build_opener(urllib.request.ProxyHandler({})); opener.open('$PUBLIC_URL/health', timeout=2)" \
    >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$PROXY" >&2
    docker logs "$WEB" >&2
    echo "Rollback proxy did not become ready" >&2
    exit 1
  fi
  sleep 1
done
COUNTS=$(python3 "$ROOT_DIR/scripts/rollback-read-smoke.py" \
  --url "$PUBLIC_URL" \
  --email "$SMOKE_EMAIL" \
  --password "$SMOKE_PASSWORD")
WORKSPACE_COUNT=${COUNTS%,*}
MEMORY_COUNT=${COUNTS#*,}
REVISION_AFTER=$(docker exec "$DB" psql --username memora --dbname memora --tuples-only --no-align \
  --command 'SELECT version_num FROM alembic_version LIMIT 1' | tr -d '[:space:]')
[ "$REVISION_BEFORE" = "$REVISION_AFTER" ] || {
  echo "Rollback application changed schema revision: $REVISION_BEFORE -> $REVISION_AFTER" >&2
  exit 1
}

VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$(dirname -- "$REPORT_PATH")"
printf '{\n  "verified_at": "%s",\n  "backup_file": "%s",\n  "schema_revision_before": "%s",\n  "schema_revision_after": "%s",\n  "images": {\n    "api": "%s",\n    "worker": "%s",\n    "web": "%s"\n  },\n  "read_smoke": {\n    "workspaces": %s,\n    "memories": %s\n  },\n  "status": "passed"\n}\n' \
  "$VERIFIED_AT" "$(basename -- "$BACKUP_PATH")" "$REVISION_BEFORE" "$REVISION_AFTER" \
  "$API_DIGEST" "$WORKER_DIGEST" "$WEB_DIGEST" "$WORKSPACE_COUNT" "$MEMORY_COUNT" \
  >"$REPORT_PATH"
chmod 600 "$REPORT_PATH"

echo "Application rollback drill passed on schema $REVISION_AFTER with $WORKSPACE_COUNT workspaces and $MEMORY_COUNT readable memories" >&2
printf '%s\n' "$REPORT_PATH"
