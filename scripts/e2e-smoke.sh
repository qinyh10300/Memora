#!/bin/sh
set -eu

public_base_url=${MEMORA_PUBLIC_URL:-http://localhost:8080}

web_response=$(curl --noproxy '*' --fail --silent --show-error "$public_base_url/health")
api_response=$(curl --noproxy '*' --fail --silent --show-error "$public_base_url/api/health")

printf '%s' "$web_response" | grep -q '"service":"web"'
printf '%s' "$api_response" | grep -q '"service":"api"'

echo "Web 与 API 健康检查通过：$public_base_url"
