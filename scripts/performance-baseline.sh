#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ -z "${MEMORA_PUBLIC_URL:-}" ]; then
  PUBLISHED_PROXY=$(docker compose port proxy 80 2>/dev/null | sed -n '1p' || true)
  [ -n "$PUBLISHED_PROXY" ] || { echo "Memora proxy is not running" >&2; exit 1; }
  MEMORA_PUBLIC_URL="http://localhost:${PUBLISHED_PROXY##*:}"
  export MEMORA_PUBLIC_URL
fi

mkdir -p artifacts
uv run --project apps/api python scripts/api-performance-baseline.py \
  --url "$MEMORA_PUBLIC_URL" \
  --samples "${PERFORMANCE_SAMPLES:-30}" \
  --warmup "${PERFORMANCE_WARMUP:-3}" \
  --search-samples "${PERFORMANCE_SEARCH_SAMPLES:-5}" \
  --search-warmup "${PERFORMANCE_SEARCH_WARMUP:-1}" \
  --output artifacts/api-performance-baseline.json
MEMORA_PUBLIC_URL="$MEMORA_PUBLIC_URL" \
  pnpm --filter @memora/web perf:baseline

CONTAINERS=$(docker compose ps --quiet db api worker web proxy)
if [ -n "$CONTAINERS" ]; then
  docker stats --no-stream --format '{{json .}}' $CONTAINERS \
    >artifacts/container-resources.ndjson
fi

echo "Performance reports written under $ROOT_DIR/artifacts" >&2
