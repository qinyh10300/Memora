#!/usr/bin/env python3
"""对已启动的本地或测试环境执行可清理的关键用户路径冒烟测试。"""

from __future__ import annotations

import json
import os
import time
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
        if created["processing_status"] not in {"PENDING", "WAITING_CONFIGURATION"}:
            raise AssertionError("新记录没有进入可靠的 AI 待处理状态")

        personal_chat = expect_status(
            alex,
            "POST",
            f"{public_url}/api/chat/questions",
            200,
            {
                "question": "我以前记录过这个验收主题吗？",
                "topic": marker,
                "scope": "PERSONAL",
                "evidence_limit": 8,
            },
        )
        if [item["memory_id"] for item in personal_chat["citations"]] != [created_id]:
            raise AssertionError("个人 Chat 没有引用自己的私有记录")

        expect_status(blair, "GET", f"{public_url}/api/memories/{created_id}", 404)
        search_url = f"{public_url}/api/search"
        private_search = expect_status(blair, "POST", search_url, 200, {"q": marker})
        if private_search["results"]:
            raise AssertionError("关键词检索泄露了其他用户的私有记录")
        if private_search["semantic_status"] != "DISABLED":
            raise AssertionError("空 embedding 配置没有明确降级为 DISABLED")
        private_chat = expect_status(
            blair,
            "POST",
            f"{public_url}/api/chat/questions",
            200,
            {
                "question": "Alex 记录过这个验收主题吗？",
                "topic": marker,
                "scope": "COLLEAGUE",
                "author_id": created["author"]["id"],
                "evidence_limit": 8,
            },
        )
        if private_chat["status"] != "NO_EVIDENCE" or private_chat["citations"]:
            raise AssertionError("同事 Chat 泄露了尚未共享的记录")
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
        shared_search = expect_status(blair, "POST", search_url, 200, {"q": marker})
        if [result["memory"]["id"] for result in shared_search["results"]] != [created_id]:
            raise AssertionError("关键词检索没有返回已授权的共享记录")
        shared_chat = expect_status(
            blair,
            "POST",
            f"{public_url}/api/chat/questions",
            200,
            {
                "question": "Alex 记录过这个验收主题吗？",
                "topic": marker,
                "scope": "COLLEAGUE",
                "author_id": created["author"]["id"],
                "evidence_limit": 8,
            },
        )
        if [item["memory_id"] for item in shared_chat["citations"]] != [created_id]:
            raise AssertionError("同事 Chat 没有引用已共享记录")

        expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{created_id}/unshare",
            200,
        )
        expect_status(blair, "GET", f"{public_url}/api/memories/{created_id}", 404)
        unshared_search = expect_status(blair, "POST", search_url, 200, {"q": marker})
        if unshared_search["results"]:
            raise AssertionError("取消共享后关键词检索仍返回记录")
        unshared_chat = expect_status(
            blair,
            "POST",
            f"{public_url}/api/chat/questions",
            200,
            {
                "question": "Alex 记录过这个验收主题吗？",
                "topic": marker,
                "scope": "COLLEAGUE",
                "author_id": created["author"]["id"],
                "evidence_limit": 8,
            },
        )
        if unshared_chat["status"] != "NO_EVIDENCE" or unshared_chat["citations"]:
            raise AssertionError("取消共享后同事 Chat 仍然返回记录")

        for _ in range(20):
            processing = expect_status(
                alex,
                "GET",
                f"{public_url}/api/memories/{created_id}",
                200,
            )["processing_status"]
            if processing == "WAITING_CONFIGURATION":
                break
            time.sleep(0.5)
        else:
            raise AssertionError("未配置 embedding 时 worker 没有进入 WAITING_CONFIGURATION")
        expect_status(alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204)
        expect_status(alex, "GET", f"{public_url}/api/memories/{created_id}", 404)
        created_id = None
    finally:
        if created_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204)

    print(f"Memora M5 关键用户路径通过：{public_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
