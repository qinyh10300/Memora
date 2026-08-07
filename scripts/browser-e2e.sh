#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${BROWSER_E2E_PROJECT_NAME:-memora-browser-e2e}
HTTP_PORT=${BROWSER_E2E_HTTP_PORT:-19180}
HTTPS_PORT=${BROWSER_E2E_HTTPS_PORT:-0}
ARTIFACT_DIR="$ROOT_DIR/artifacts/playwright"

export APP_ENV=test
export CADDY_SITE_ADDRESS=http://localhost
export HTTP_PORT
export HTTPS_PORT
export POSTGRES_DB=memora_e2e
export POSTGRES_USER=memora_e2e
export POSTGRES_PASSWORD=memora-e2e-password
export SESSION_SECRET=browser-e2e-session-secret-not-for-production
export SEED_DEVELOPMENT_DATA_ENABLED=true
export AI_CHAT_BASE_URL=http://fake-ai:18081/v1
export AI_CHAT_API_KEY=browser-e2e-key
export AI_CHAT_MODEL=e2e-chat
export AI_MODEL_REGISTRY_JSON='[{"id":"gpt","label":"GPT E2E","provider_model":"e2e-chat","provider_family":"gpt","capabilities":["chat","vision","web_search","tools"],"cost_tier":"balanced","priority":10,"timeout_seconds":60,"fallback_ids":[],"default":true}]'
export AI_EMBEDDING_BASE_URL=http://fake-ai:18081/v1
export AI_EMBEDDING_API_KEY=browser-e2e-key
export AI_EMBEDDING_MODEL=e2e-embedding
export AI_WEB_SEARCH_MODEL=e2e-search
export METRICS_ENABLED=true
export METRICS_TOKEN=browser-e2e-metrics-token-not-for-production
export DOCKER_NO_PROXY=localhost,127.0.0.1,db,api,web,worker,proxy,fake-ai

compose() {
  docker compose --project-name "$PROJECT_NAME" --profile e2e "$@"
}

finish() {
  status=$?
  trap - EXIT
  mkdir -p "$ARTIFACT_DIR"
  compose logs --no-color >"$ARTIFACT_DIR/compose.log" 2>&1 || true
  if [ "${KEEP_BROWSER_E2E:-0}" != "1" ]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap finish EXIT

cd "$ROOT_DIR"
mkdir -p "$ARTIFACT_DIR"
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
pnpm --filter @memora/web exec playwright install chromium
compose up --detach --build --wait fake-ai db migrate seed api worker web proxy

PLAYWRIGHT_BASE_URL="http://localhost:$HTTP_PORT" \
  pnpm --filter @memora/web exec playwright test
