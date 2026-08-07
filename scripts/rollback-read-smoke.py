#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
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
        with opener.open(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"{method} {url} returned {response.status}")
            content = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} returned {error.code}: {detail}") from error
    return None if not content else json.loads(content)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only smoke test for a rolled-back Memora app"
    )
    parser.add_argument("--url", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(CookieJar()),
    )
    request_json(opener, "GET", f"{base_url}/health")
    request_json(opener, "GET", f"{base_url}/api/health")
    request_json(
        opener,
        "POST",
        f"{base_url}/api/auth/login",
        {"email": args.email, "password": args.password},
    )
    workspaces = request_json(opener, "GET", f"{base_url}/api/workspaces")
    personal_workspace = next(
        (workspace for workspace in workspaces if workspace["kind"] == "PERSONAL"),
        None,
    )
    if personal_workspace is None:
        raise RuntimeError("Rollback account has no personal workspace")
    request_json(
        opener,
        "POST",
        f"{base_url}/api/workspaces/{personal_workspace['id']}/activate",
    )
    memories = request_json(opener, "GET", f"{base_url}/api/memories")
    if not memories:
        raise RuntimeError("Rollback account cannot read any memory")
    memory = request_json(opener, "GET", f"{base_url}/api/memories/{memories[0]['id']}")
    if memory["id"] != memories[0]["id"] or not memory.get("body"):
        raise RuntimeError("Rollback memory response is incomplete")

    print(f"{len(workspaces)},{len(memories)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
