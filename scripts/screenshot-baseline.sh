#!/bin/sh
# Boots the browser-e2e compose stack (kept up between runs) and captures the
# UI screenshot matrix defined in apps/web/e2e/screenshots.spec.ts.
# Usage: SCREENSHOT_DIR=artifacts/screenshots/<tag> scripts/screenshot-baseline.sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${SCREENS_PROJECT_NAME:-memora-screens}
HTTP_PORT=${SCREENS_HTTP_PORT:-19180}

export APP_ENV=test
export CADDY_SITE_ADDRESS=http://localhost
export HTTP_PORT
export HTTPS_PORT=0
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

cd "$ROOT_DIR"
# PYPI_INDEX lets constrained networks point the API image build at a regional
# PyPI mirror; building explicitly (instead of `up --build`) lets us pass the
# arg so the build-layer cache stays stable across manual and scripted builds.
docker compose --project-name "$PROJECT_NAME" --profile e2e build \
  --build-arg PYPI_INDEX="${PYPI_INDEX:-https://pypi.org/simple/}" \
  migrate seed api worker web
docker compose --project-name "$PROJECT_NAME" --profile e2e up --detach --wait fake-ai db migrate seed api worker web proxy

PLAYWRIGHT_BASE_URL="http://localhost:$HTTP_PORT" \
  SCREENSHOT_DIR="${SCREENSHOT_DIR:-$ROOT_DIR/artifacts/screenshots/current}" \
  pnpm --filter @memora/web exec playwright test e2e/screenshots.spec.ts
