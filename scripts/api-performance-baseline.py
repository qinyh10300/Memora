#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


def request_json(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    try:
        with opener.open(request, timeout=15) as response:
            content = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} returned {error.code}: {detail}") from error
    return None if not content else json.loads(content)


def measure(operation: Callable[[], Any], samples: int, warmup: int) -> dict[str, float | int]:
    for _ in range(warmup):
        operation()
    durations: list[float] = []
    for _ in range(samples):
        started = time.perf_counter()
        operation()
        durations.append((time.perf_counter() - started) * 1000)
    ordered = sorted(durations)
    p95_index = max(0, math.ceil(len(ordered) * 0.95) - 1)
    return {
        "samples": samples,
        "p50_ms": round(statistics.median(ordered), 2),
        "p95_ms": round(ordered[p95_index], 2),
        "max_ms": round(ordered[-1], 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure local Memora API latency")
    parser.add_argument("--url", default=os.getenv("MEMORA_PUBLIC_URL", "http://localhost:8080"))
    parser.add_argument("--email", default=os.getenv("SEED_USER_1_EMAIL", "alex@memora.local"))
    parser.add_argument(
        "--password", default=os.getenv("SEED_USER_1_PASSWORD", "memora-local-alex")
    )
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--search-samples", type=int, default=5)
    parser.add_argument("--search-warmup", type=int, default=1)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.samples < 5 or args.search_samples < 3:
        parser.error("samples must be at least 5 and search samples at least 3")
    if args.warmup < 0 or args.search_warmup < 0:
        parser.error("warmup counts cannot be negative")

    base_url = args.url.rstrip("/")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(CookieJar()),
    )
    request_json(
        opener,
        "POST",
        f"{base_url}/api/auth/login",
        {"email": args.email, "password": args.password},
    )
    workspaces = request_json(opener, "GET", f"{base_url}/api/workspaces")
    personal_workspace = next(
        (workspace for workspace in workspaces if workspace["kind"] == "PERSONAL"), None
    )
    if personal_workspace is None:
        raise RuntimeError("Performance account has no personal workspace")
    request_json(
        opener,
        "POST",
        f"{base_url}/api/workspaces/{personal_workspace['id']}/activate",
    )

    results = {
        "web_health": measure(
            lambda: request_json(opener, "GET", f"{base_url}/health"), args.samples, args.warmup
        ),
        "api_health": measure(
            lambda: request_json(opener, "GET", f"{base_url}/api/health"),
            args.samples,
            args.warmup,
        ),
        "workspaces": measure(
            lambda: request_json(opener, "GET", f"{base_url}/api/workspaces"),
            args.samples,
            args.warmup,
        ),
        "memory_list": measure(
            lambda: request_json(opener, "GET", f"{base_url}/api/memories"),
            args.samples,
            args.warmup,
        ),
        "hybrid_search": measure(
            lambda: request_json(opener, "POST", f"{base_url}/api/search", {"q": "团队 研究 记忆"}),
            args.search_samples,
            args.search_warmup,
        ),
    }
    report = {
        "measured_at": datetime.now(UTC).isoformat(),
        "base_url": base_url,
        "workspace_count": len(workspaces),
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
