#!/bin/sh
set -eu

public_base_url=${MEMORA_PUBLIC_URL:-http://localhost:8080}
max_attempts=${MEMORA_WAIT_ATTEMPTS:-60}
attempt=1

while [ "$attempt" -le "$max_attempts" ]; do
    if curl --noproxy '*' --fail --silent "$public_base_url/health" >/dev/null 2>&1 \
        && curl --noproxy '*' --fail --silent "$public_base_url/api/health" >/dev/null 2>&1; then
        echo "Memora 服务已就绪。"
        exit 0
    fi

    echo "等待 Memora 服务启动（$attempt/${max_attempts}）..."
    attempt=$((attempt + 1))
    sleep 2
done

echo "等待 Memora 服务超时。" >&2
exit 1
