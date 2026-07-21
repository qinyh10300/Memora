#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
generated_contract=$(mktemp)
generated_types=$(mktemp)
trap 'rm -f "$generated_contract" "$generated_types"' EXIT HUP INT TERM

cd "$repository_root/apps/api"
uv run memora-export-openapi --output "$generated_contract"

if ! diff -u "$repository_root/packages/api-contract/openapi.json" "$generated_contract"; then
    echo "OpenAPI 契约已过期。请运行 make contract 并提交生成结果。" >&2
    exit 1
fi

cd "$repository_root"
pnpm exec openapi-typescript "$generated_contract" --output "$generated_types"

if ! diff -u "$repository_root/packages/api-contract/schema.d.ts" "$generated_types"; then
    echo "TypeScript API 类型已过期。请运行 make contract 并提交生成结果。" >&2
    exit 1
fi
