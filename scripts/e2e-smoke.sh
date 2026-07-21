#!/bin/sh
set -eu

exec uv run --project apps/api python scripts/e2e_smoke.py
