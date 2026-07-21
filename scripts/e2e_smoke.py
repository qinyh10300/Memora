#!/usr/bin/env python3
"""对已启动的本地或测试环境执行可清理的关键用户路径冒烟测试。"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import suppress
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, OpenerDirector, ProxyHandler, Request, build_opener


def build_client() -> OpenerDirector:
    return build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))


def request_json(
    client: OpenerDirector,
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with client.open(request, timeout=15) as response:
        response_body = response.read()
        return response.status, json.loads(response_body) if response_body else None


def expect_status(
    client: OpenerDirector,
    method: str,
    url: str,
    expected: int,
    payload: dict[str, Any] | None = None,
) -> Any:
    try:
        status, body = request_json(client, method, url, payload)
    except HTTPError as error:
        if error.code == expected:
            return None
        raise AssertionError(f"{method} {url} 返回 {error.code}，期望 {expected}") from error
    if status != expected:
        raise AssertionError(f"{method} {url} 返回 {status}，期望 {expected}")
    return body


def main() -> int:
    public_url = os.getenv("MEMORA_PUBLIC_URL", "http://localhost:8080").rstrip("/")
    alex_email = os.getenv("SEED_USER_1_EMAIL", "alex@memora.local")
    alex_password = os.getenv("SEED_USER_1_PASSWORD", "memora-local-alex")
    blair_email = os.getenv("SEED_USER_2_EMAIL", "blair@memora.local")
    blair_password = os.getenv("SEED_USER_2_PASSWORD", "memora-local-blair")
    alex = build_client()
    blair = build_client()
    created_id: str | None = None

    expect_status(alex, "GET", f"{public_url}/health", 200)
    expect_status(alex, "GET", f"{public_url}/api/health", 200)
    expect_status(
        alex,
        "POST",
        f"{public_url}/api/auth/login",
        200,
        {"email": alex_email, "password": alex_password},
    )
    expect_status(
        blair,
        "POST",
        f"{public_url}/api/auth/login",
        200,
        {"email": blair_email, "password": blair_password},
    )

    try:
        marker = uuid.uuid4().hex
        created = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories",
            201,
            {"body": f"M3 E2E 权限记录 {marker}"},
        )
        created_id = str(created["id"])
        if created["visibility"] != "PRIVATE":
            raise AssertionError("新记录没有默认为 PRIVATE")

        expect_status(blair, "GET", f"{public_url}/api/memories/{created_id}", 404)
        shared = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{created_id}/share",
            200,
        )
        if shared["visibility"] != "WORKSPACE":
            raise AssertionError("主动分享后可见性没有变为 WORKSPACE")
        visible_to_blair = expect_status(
            blair,
            "GET",
            f"{public_url}/api/memories/{created_id}",
            200,
        )
        if marker not in visible_to_blair["body"]:
            raise AssertionError("共享记录正文与创建内容不一致")

        expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{created_id}/unshare",
            200,
        )
        expect_status(blair, "GET", f"{public_url}/api/memories/{created_id}", 404)
        expect_status(alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204)
        expect_status(alex, "GET", f"{public_url}/api/memories/{created_id}", 404)
        created_id = None
    finally:
        if created_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204)

    print(f"Memora M3 关键用户路径通过：{public_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
