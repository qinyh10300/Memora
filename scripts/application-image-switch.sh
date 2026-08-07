#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${SWITCH_COMPOSE_PROJECT_NAME:-memora}
API_SOURCE=${SWITCH_API_IMAGE:-}
WORKER_SOURCE=${SWITCH_WORKER_IMAGE:-}
WEB_SOURCE=${SWITCH_WEB_IMAGE:-}
REPORT_PATH=${SWITCH_REPORT_PATH:-"$ROOT_DIR/artifacts/application-image-switch.json"}

usage() {
  echo "Usage: SWITCH_API_IMAGE=... SWITCH_WORKER_IMAGE=... SWITCH_WEB_IMAGE=... $0" >&2
}

[ -n "$API_SOURCE" ] && [ -n "$WORKER_SOURCE" ] && [ -n "$WEB_SOURCE" ] || {
  usage
  exit 2
}

compose() {
  docker compose --project-name "$PROJECT_NAME" "$@"
}

for image in "$API_SOURCE" "$WORKER_SOURCE" "$WEB_SOURCE"; do
  docker image inspect "$image" >/dev/null
done

API_DIGEST=$(docker image inspect "$API_SOURCE" --format '{{.Id}}')
WORKER_DIGEST=$(docker image inspect "$WORKER_SOURCE" --format '{{.Id}}')
WEB_DIGEST=$(docker image inspect "$WEB_SOURCE" --format '{{.Id}}')
TAG_SUFFIX=$(date -u +%Y%m%dT%H%M%SZ)-$$
API_TARGET="memora-api:switch-$TAG_SUFFIX"
WORKER_TARGET="memora-worker:switch-$TAG_SUFFIX"
WEB_TARGET="memora-web:switch-$TAG_SUFFIX"

docker image tag "$API_SOURCE" "$API_TARGET"
docker image tag "$WORKER_SOURCE" "$WORKER_TARGET"
docker image tag "$WEB_SOURCE" "$WEB_TARGET"

REVISION_BEFORE=$(compose exec -T db sh -c \
  'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT version_num FROM alembic_version LIMIT 1"' \
  | tr -d '[:space:]')
PREVIOUS_API=$(docker inspect "$(compose ps -q api)" --format '{{.Image}}')
PREVIOUS_WORKER=$(docker inspect "$(compose ps -q worker)" --format '{{.Image}}')
PREVIOUS_WEB=$(docker inspect "$(compose ps -q web)" --format '{{.Image}}')

export MEMORA_API_IMAGE="$API_TARGET"
export MEMORA_WORKER_IMAGE="$WORKER_TARGET"
export MEMORA_WEB_IMAGE="$WEB_TARGET"
compose up --detach --no-build --no-deps --force-recreate api worker web

attempt=0
until compose exec -T api python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=2)" \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    compose logs --no-color --tail=200 api >&2
    exit 1
  fi
  sleep 1
done
compose exec -T web node -e \
  "fetch('http://127.0.0.1:3000/health').then(r => { if (!r.ok) process.exit(1) })"
[ "$(docker inspect "$(compose ps -q worker)" --format '{{.State.Running}}')" = true ] || {
  compose logs --no-color --tail=200 worker >&2
  exit 1
}

# Caddy resolves static upstream names when its config is loaded. Refresh it after
# recreating API/Web containers so the public route does not retain stale IPs.
compose restart proxy >/dev/null
PUBLIC_BASE_URL=${SWITCH_PUBLIC_BASE_URL:-}
if [ -z "$PUBLIC_BASE_URL" ]; then
  PROXY_HTTP_PORT=$(compose port proxy 80 | tail -n 1 | sed 's/.*://')
  PUBLIC_BASE_URL="http://127.0.0.1:$PROXY_HTTP_PORT"
fi
attempt=0
until curl --noproxy '*' --fail --silent --show-error "$PUBLIC_BASE_URL/" >/dev/null 2>&1 \
  && curl --noproxy '*' --fail --silent --show-error "$PUBLIC_BASE_URL/api/ready" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    compose logs --no-color --tail=200 proxy api web >&2
    exit 1
  fi
  sleep 1
done

ACTUAL_API=$(docker inspect "$(compose ps -q api)" --format '{{.Image}}')
ACTUAL_WORKER=$(docker inspect "$(compose ps -q worker)" --format '{{.Image}}')
ACTUAL_WEB=$(docker inspect "$(compose ps -q web)" --format '{{.Image}}')
[ "$ACTUAL_API" = "$API_DIGEST" ]
[ "$ACTUAL_WORKER" = "$WORKER_DIGEST" ]
[ "$ACTUAL_WEB" = "$WEB_DIGEST" ]

REVISION_AFTER=$(compose exec -T db sh -c \
  'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT version_num FROM alembic_version LIMIT 1"' \
  | tr -d '[:space:]')
[ "$REVISION_BEFORE" = "$REVISION_AFTER" ] || {
  echo "Application image switch changed schema revision: $REVISION_BEFORE -> $REVISION_AFTER" >&2
  exit 1
}

VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$(dirname -- "$REPORT_PATH")"
printf '{\n  "verified_at": "%s",\n  "compose_project": "%s",\n  "schema_revision_before": "%s",\n  "schema_revision_after": "%s",\n  "previous_images": {\n    "api": "%s",\n    "worker": "%s",\n    "web": "%s"\n  },\n  "selected_images": {\n    "api": "%s",\n    "worker": "%s",\n    "web": "%s"\n  },\n  "status": "passed"\n}\n' \
  "$VERIFIED_AT" "$PROJECT_NAME" "$REVISION_BEFORE" "$REVISION_AFTER" \
  "$PREVIOUS_API" "$PREVIOUS_WORKER" "$PREVIOUS_WEB" \
  "$ACTUAL_API" "$ACTUAL_WORKER" "$ACTUAL_WEB" >"$REPORT_PATH"
chmod 600 "$REPORT_PATH"

echo "Application image switch passed on schema $REVISION_AFTER" >&2
printf '%s\n' "$REPORT_PATH"
