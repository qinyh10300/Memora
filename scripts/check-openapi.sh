#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
generated_contract=$(mktemp)
trap 'rm -f "$generated_contract"' EXIT HUP INT TERM

cd "$repository_root/apps/api"
uv run memora-export-openapi --output "$generated_contract"

if ! diff -u "$repository_root/packages/api-contract/openapi.json" "$generated_contract"; then
    echo "OpenAPI 契约已过期。请运行 make contract 并提交生成结果。" >&2
    exit 1
fi
