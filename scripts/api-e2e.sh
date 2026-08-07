#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${API_E2E_PROJECT_NAME:-memora-api-e2e}
HTTP_PORT=${API_E2E_HTTP_PORT:-19181}
HTTPS_PORT=${API_E2E_HTTPS_PORT:-0}
ARTIFACT_DIR="$ROOT_DIR/artifacts/api-e2e"

export APP_ENV=test
export CADDY_SITE_ADDRESS=http://localhost
export HTTP_PORT
export HTTPS_PORT
export POSTGRES_DB=memora_api_e2e
export POSTGRES_USER=memora_api_e2e
export POSTGRES_PASSWORD=memora-api-e2e-password
export SESSION_SECRET=api-e2e-session-secret-not-for-production
export SEED_DEVELOPMENT_DATA_ENABLED=true
export AI_CHAT_BASE_URL=http://fake-ai:18081/v1
export AI_CHAT_API_KEY=api-e2e-key
export AI_CHAT_MODEL=e2e-chat
export AI_MODEL_REGISTRY_JSON='[{"id":"gpt","label":"GPT E2E","provider_model":"e2e-chat","provider_family":"gpt","capabilities":["chat","vision","web_search","tools"],"cost_tier":"balanced","priority":10,"timeout_seconds":60,"fallback_ids":[],"default":true}]'
export AI_EMBEDDING_BASE_URL=http://fake-ai:18081/v1
export AI_EMBEDDING_API_KEY=api-e2e-key
export AI_EMBEDDING_MODEL=e2e-embedding
export AI_WEB_SEARCH_MODEL=e2e-search
export AI_IMAGE_BASE_URL=http://fake-ai:18081/v1
export AI_IMAGE_API_KEY=api-e2e-key
export AI_IMAGE_MODEL_REGISTRY_JSON='[{"id":"gpt-image-2","label":"GPT Image 2 E2E","provider_model":"e2e-image","provider_family":"gpt","min_plan":"PLUS","configured":true}]'
export METRICS_ENABLED=false
export DOCKER_NO_PROXY=localhost,127.0.0.1,db,api,web,worker,proxy,fake-ai

compose() {
  docker compose --project-name "$PROJECT_NAME" --profile e2e "$@"
}

finish() {
  status=$?
  trap - EXIT
  mkdir -p "$ARTIFACT_DIR"
  compose logs --no-color >"$ARTIFACT_DIR/compose.log" 2>&1 || true
  if [ "${KEEP_API_E2E:-0}" != "1" ]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap finish EXIT

cd "$ROOT_DIR"
mkdir -p "$ARTIFACT_DIR"
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up --detach --build --wait fake-ai db migrate seed api worker web proxy

MEMORA_PUBLIC_URL="http://localhost:$HTTP_PORT" ./scripts/e2e-smoke.sh
