#!/usr/bin/env python3
"""对已启动的本地或测试环境执行可清理的关键用户路径冒烟测试。"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError
from urllib.request import (
    HTTPCookieProcessor,
    OpenerDirector,
    ProxyHandler,
    Request,
    build_opener,
)


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
        raise AssertionError(
            f"{method} {url} 返回 {error.code}，期望 {expected}"
        ) from error
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
    alex_conversation_id: str | None = None
    blair_conversation_id: str | None = None
    team_workspace_id: str | None = None

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
        alex_workspaces = expect_status(
            alex,
            "GET",
            f"{public_url}/api/workspaces",
            200,
        )
        blair_workspaces = expect_status(
            blair,
            "GET",
            f"{public_url}/api/workspaces",
            200,
        )
        alex_personal = next(
            (
                workspace
                for workspace in alex_workspaces
                if workspace["kind"] == "PERSONAL"
            ),
            None,
        )
        alex_team = next(
            (workspace for workspace in alex_workspaces if workspace["kind"] == "TEAM"),
            None,
        )
        if alex_personal is None or alex_team is None:
            raise AssertionError("Alex 没有同时获得个人空间和团队空间")
        if not alex_team["is_current"]:
            raise AssertionError("新登录会话没有进入已有团队空间")
        if (
            len(
                [
                    workspace
                    for workspace in blair_workspaces
                    if workspace["kind"] == "PERSONAL"
                ]
            )
            != 1
        ):
            raise AssertionError("Blair 没有且仅有一个个人空间")
        team_workspace_id = str(alex_team["id"])

        alex_conversation = expect_status(
            alex,
            "POST",
            f"{public_url}/api/conversations",
            201,
            {"title": "E2E 持久对话"},
        )
        alex_conversation_id = str(alex_conversation["id"])
        blair_conversation = expect_status(
            blair,
            "POST",
            f"{public_url}/api/conversations",
            201,
            {"title": "E2E 授权对话"},
        )
        blair_conversation_id = str(blair_conversation["id"])
        expect_status(
            blair,
            "GET",
            f"{public_url}/api/conversations/{alex_conversation_id}",
            404,
        )
        expect_status(
            blair,
            "POST",
            f"{public_url}/api/workspaces/{alex_personal['id']}/activate",
            404,
        )

        marker = uuid.uuid4().hex
        created = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories",
            201,
            {
                "body": f"v0.2 E2E 权限记录 {marker}",
                "conversation_id": alex_conversation_id,
            },
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
                "conversation_id": alex_conversation_id,
            },
        )
        if [item["memory_id"] for item in personal_chat["citations"]] != [created_id]:
            raise AssertionError("个人 Chat 没有引用自己的私有记录")

        restored = expect_status(
            alex,
            "GET",
            f"{public_url}/api/conversations/{alex_conversation_id}",
            200,
        )
        if restored["message_count"] != 4:
            raise AssertionError("记录与问答没有追加到同一个持久对话")
        if restored["messages"][0]["memory"]["id"] != created_id:
            raise AssertionError("对话记录没有关联原始 memory")
        if restored["messages"][3]["citations"][0]["memory_id"] != created_id:
            raise AssertionError("恢复的回答没有保留可授权引用")

        expect_status(
            alex,
            "POST",
            f"{public_url}/api/workspaces/{alex_personal['id']}/activate",
            200,
        )
        personal_conversations = expect_status(
            alex,
            "GET",
            f"{public_url}/api/conversations",
            200,
        )
        if any(item["id"] == alex_conversation_id for item in personal_conversations):
            raise AssertionError("团队空间 conversation 泄露到个人空间")
        expect_status(alex, "GET", f"{public_url}/api/memories/{created_id}", 404)
        expect_status(
            alex,
            "POST",
            f"{public_url}/api/workspaces/{team_workspace_id}/activate",
            200,
        )

        now = datetime.now(UTC)
        report_range = {
            "created_from": (now - timedelta(days=1)).isoformat(),
            "created_to": (now + timedelta(days=1)).isoformat(),
        }
        personal_report = expect_status(
            alex,
            "POST",
            f"{public_url}/api/reports",
            200,
            {
                "scope": "PERSONAL",
                "topic": marker,
                "evidence_limit": 20,
                **report_range,
            },
        )
        if [item["memory_id"] for item in personal_report["citations"]] != [created_id]:
            raise AssertionError("个人报告没有引用自己的私有记录")

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
                "conversation_id": blair_conversation_id,
            },
        )
        if private_chat["status"] != "NO_EVIDENCE" or private_chat["citations"]:
            raise AssertionError("同事 Chat 泄露了尚未共享的记录")
        private_report = expect_status(
            blair,
            "POST",
            f"{public_url}/api/reports",
            200,
            {
                "scope": "COLLEAGUE",
                "author_id": created["author"]["id"],
                "topic": marker,
                "evidence_limit": 20,
                **report_range,
            },
        )
        if private_report["status"] != "NO_EVIDENCE" or private_report["citations"]:
            raise AssertionError("同事报告泄露了尚未共享的记录")
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
        if [result["memory"]["id"] for result in shared_search["results"]] != [
            created_id
        ]:
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
                "conversation_id": blair_conversation_id,
            },
        )
        if [item["memory_id"] for item in shared_chat["citations"]] != [created_id]:
            raise AssertionError("同事 Chat 没有引用已共享记录")
        shared_report = expect_status(
            blair,
            "POST",
            f"{public_url}/api/reports",
            200,
            {
                "scope": "WORKSPACE",
                "topic": marker,
                "evidence_limit": 20,
                **report_range,
            },
        )
        if [item["memory_id"] for item in shared_report["citations"]] != [created_id]:
            raise AssertionError("团队报告没有引用已共享记录")
        if [section["kind"] for section in shared_report["sections"]] != [
            "TIMELINE",
            "CONTINUITY",
            "CHANGES",
            "CONTRADICTIONS",
            "GAPS",
        ]:
            raise AssertionError("报告没有返回固定的五类证据结构")

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
                "conversation_id": blair_conversation_id,
            },
        )
        if unshared_chat["status"] != "NO_EVIDENCE" or unshared_chat["citations"]:
            raise AssertionError("取消共享后同事 Chat 仍然返回记录")
        unshared_report = expect_status(
            blair,
            "POST",
            f"{public_url}/api/reports",
            200,
            {
                "scope": "WORKSPACE",
                "topic": marker,
                "evidence_limit": 20,
                **report_range,
            },
        )
        if unshared_report["status"] != "NO_EVIDENCE" or unshared_report["citations"]:
            raise AssertionError("取消共享后团队报告仍然返回记录")

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
            raise AssertionError(
                "未配置 embedding 时 worker 没有进入 WAITING_CONFIGURATION"
            )
        expect_status(alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204)
        expect_status(alex, "GET", f"{public_url}/api/memories/{created_id}", 404)
        redacted = expect_status(
            alex,
            "GET",
            f"{public_url}/api/conversations/{alex_conversation_id}",
            200,
        )
        if marker in json.dumps(redacted["messages"], ensure_ascii=False):
            raise AssertionError("memory 删除后 conversation 仍残留私有正文或引用")
        if redacted["messages"][0]["status"] != "REDACTED":
            raise AssertionError("memory 删除后 capture 消息没有标记为 REDACTED")
        created_id = None
    finally:
        if team_workspace_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(
                    alex,
                    "POST",
                    f"{public_url}/api/workspaces/{team_workspace_id}/activate",
                    200,
                )
        if created_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(
                    alex, "DELETE", f"{public_url}/api/memories/{created_id}", 204
                )
        if alex_conversation_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(
                    alex,
                    "PATCH",
                    f"{public_url}/api/conversations/{alex_conversation_id}",
                    200,
                    {"archived": True},
                )
        if blair_conversation_id is not None:
            with suppress(AssertionError, HTTPError):
                expect_status(
                    blair,
                    "PATCH",
                    f"{public_url}/api/conversations/{blair_conversation_id}",
                    200,
                    {"archived": True},
                )

    print(f"Memora v0.2 多空间、持久对话与权限关键路径通过：{public_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
