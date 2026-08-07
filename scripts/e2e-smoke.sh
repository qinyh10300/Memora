#!/bin/sh
set -eu

if [ -z "${MEMORA_PUBLIC_URL:-}" ]; then
  PUBLISHED_PROXY=$(docker compose port proxy 80 2>/dev/null | sed -n '1p' || true)
  if [ -n "$PUBLISHED_PROXY" ]; then
    export MEMORA_PUBLIC_URL="http://localhost:${PUBLISHED_PROXY##*:}"
  else
    export MEMORA_PUBLIC_URL="http://localhost:8080"
  fi
fi

exec uv run --project apps/api python scripts/e2e_smoke.py
