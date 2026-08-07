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
    timeout_seconds = float(os.getenv("MEMORA_E2E_TIMEOUT_SECONDS", "90"))
    with client.open(request, timeout=timeout_seconds) as response:
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


def wait_for_visual(
    client: OpenerDirector,
    public_url: str,
    project_id: str,
    expected_status: str,
) -> dict[str, Any]:
    for _ in range(60):
        project = expect_status(
            client,
            "GET",
            f"{public_url}/api/visuals/{project_id}",
            200,
        )
        if project["status"] == expected_status:
            return project
        if project["status"] in {"FAILED", "CANCELLED"}:
            raise AssertionError(
                f"visual {project_id} 进入非预期状态 {project['status']}"
            )
        time.sleep(0.5)
    raise AssertionError(f"visual {project_id} 没有进入 {expected_status}")


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
    alex_personal_workspace_id: str | None = None
    personal_cleanup_ids: list[str] = []

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
        alex_personal_workspace_id = str(alex_personal["id"])

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

        personal_original_marker = f"personal-original-{uuid.uuid4().hex}"
        personal_current_marker = f"personal-current-{uuid.uuid4().hex}"
        draft_result = expect_status(
            alex,
            "POST",
            f"{public_url}/api/drafts/refine",
            200,
            {
                "markdown": "",
                "instruction": f"记录个人 Markdown {personal_original_marker}",
            },
        )
        model_status = draft_result["model_status"]
        if model_status == "AVAILABLE":
            if not draft_result["markdown"].strip():
                raise AssertionError("模型成功时没有生成 Markdown")
        elif model_status in {"DISABLED", "DEGRADED"}:
            if personal_original_marker not in draft_result["markdown"]:
                raise AssertionError("模型不可用时没有安全保留用户原文")
        else:
            raise AssertionError(f"未知的草稿模型状态: {model_status}")
        before_save = expect_status(
            alex,
            "GET",
            f"{public_url}/api/memories",
            200,
        )
        if any(personal_original_marker in item["body"] for item in before_save):
            raise AssertionError("草稿修改接口在用户保存前创建了 memory")

        personal_root = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories",
            201,
            {"body": draft_result["markdown"]},
        )
        personal_root_id = str(personal_root["id"])
        personal_cleanup_ids = [personal_root_id]
        personal_updated = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{personal_root_id}/revisions",
            201,
            {
                "body": f"# 个人验收\n\n当前内容 {personal_current_marker}",
                "mode": "UPDATE_CURRENT",
            },
        )
        personal_updated_id = str(personal_updated["id"])
        personal_cleanup_ids = [personal_updated_id]
        personal_list = expect_status(
            alex,
            "GET",
            f"{public_url}/api/memories",
            200,
        )
        same_timeline = [
            item
            for item in personal_list
            if item["timeline_entry_id"] == personal_root["timeline_entry_id"]
        ]
        if [item["id"] for item in same_timeline] != [personal_updated_id]:
            raise AssertionError("更新当前记忆后时间线没有且仅有最新修订")
        revision_history = expect_status(
            alex,
            "GET",
            f"{public_url}/api/memories/{personal_updated_id}/revisions",
            200,
        )
        if [item["id"] for item in revision_history] != [
            personal_updated_id,
            personal_root_id,
        ]:
            raise AssertionError("更新当前记忆后没有保留不可变修订历史")
        old_revision_search = expect_status(
            alex,
            "POST",
            f"{public_url}/api/search",
            200,
            {"q": personal_original_marker},
        )
        if any(
            result["memory"]["id"] == personal_root_id
            or personal_original_marker in result["memory"]["body"]
            for result in old_revision_search["results"]
        ):
            raise AssertionError("被替代的内部修订仍进入活动检索")

        personal_new_version = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{personal_updated_id}/revisions",
            201,
            {
                "body": f"# 个人验收新版本\n\n{personal_current_marker} 新时间点",
                "mode": "NEW_VERSION",
            },
        )
        personal_new_version_id = str(personal_new_version["id"])
        personal_cleanup_ids = [personal_updated_id, personal_new_version_id]
        after_new_version = expect_status(
            alex,
            "GET",
            f"{public_url}/api/memories",
            200,
        )
        visible_personal_ids = {
            item["id"]
            for item in after_new_version
            if personal_current_marker in item["body"]
        }
        if visible_personal_ids != {personal_updated_id, personal_new_version_id}:
            raise AssertionError("保存为新版本后没有保留两个独立时间点")
        expect_status(
            blair,
            "GET",
            f"{public_url}/api/memories/{personal_new_version_id}",
            404,
        )

        expect_status(
            alex,
            "DELETE",
            f"{public_url}/api/memories/{personal_updated_id}",
            204,
        )
        personal_cleanup_ids = [personal_new_version_id]
        expect_status(
            alex,
            "GET",
            f"{public_url}/api/memories/{personal_new_version_id}",
            200,
        )
        expect_status(
            alex,
            "DELETE",
            f"{public_url}/api/memories/{personal_new_version_id}",
            204,
        )
        personal_cleanup_ids = []

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
        if any(
            result["memory"]["id"] == created_id for result in private_search["results"]
        ):
            raise AssertionError("关键词检索泄露了其他用户的私有记录")
        if private_search["semantic_status"] not in {
            "AVAILABLE",
            "DISABLED",
            "DEGRADED",
        }:
            raise AssertionError("检索没有返回明确的语义能力状态")
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
        if created_id not in {
            result["memory"]["id"] for result in shared_search["results"]
        }:
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

        report_history = expect_status(
            blair,
            "GET",
            f"{public_url}/api/reports",
            200,
        )
        if shared_report["report_id"] not in {
            report["report_id"] for report in report_history
        }:
            raise AssertionError("团队报告刷新后没有保留在历史中")
        report_subscription = expect_status(
            alex,
            "POST",
            f"{public_url}/api/report-subscriptions",
            201,
            {
                "preset": "MISSED",
                "scope": "WORKSPACE",
                "topic": marker,
                "visibility": "PRIVATE",
                "cadence": "WEEKLY",
            },
        )
        paused_subscription = expect_status(
            alex,
            "PATCH",
            f"{public_url}/api/report-subscriptions/{report_subscription['id']}",
            200,
            {"status": "PAUSED"},
        )
        if paused_subscription["status"] != "PAUSED":
            raise AssertionError("定期报告没有成功暂停")

        structured_project = expect_status(
            alex,
            "POST",
            f"{public_url}/api/visuals",
            201,
            {
                "title": "E2E 证据思维导图",
                "mode": "STRUCTURED",
                "kind": "MIND_MAP",
                "visibility": "WORKSPACE",
            },
        )
        structured_project_id = str(structured_project["id"])
        expect_status(
            alex,
            "POST",
            f"{public_url}/api/visuals/{structured_project_id}/generate",
            200,
            {
                "prompt": f"根据 {marker} 生成一张证据思维导图",
                "model_id": "gpt",
                "memory_ids": [created_id],
            },
        )
        structured_result = wait_for_visual(
            alex,
            public_url,
            structured_project_id,
            "WAITING_CONFIRMATION",
        )
        structured_version = structured_result["versions"][0]
        confirmed_visual = expect_status(
            alex,
            "POST",
            f"{public_url}/api/visuals/{structured_project_id}/confirm-structure",
            200,
            {"version_id": structured_version["id"]},
        )
        if confirmed_visual["versions"][0]["diagram_id"] is None:
            raise AssertionError("结构图确认后没有创建可编辑 diagram")

        image_project = expect_status(
            alex,
            "POST",
            f"{public_url}/api/visuals",
            201,
            {
                "title": "E2E 科研图片",
                "mode": "IMAGE",
                "kind": "SCIENTIFIC",
                "visibility": "PRIVATE",
            },
        )
        image_project_id = str(image_project["id"])
        expect_status(
            alex,
            "POST",
            f"{public_url}/api/visuals/{image_project_id}/generate",
            200,
            {
                "prompt": "生成一张 E2E 科研插画",
                "model_id": "gpt-image-2",
                "memory_ids": [],
                "aspect_ratio": "16:9",
                "count": 1,
                "scientific_style": True,
                "watermark_mode": "CLEAN_OUTPUT",
                "output_language": "中文",
            },
        )
        image_result = wait_for_visual(
            alex,
            public_url,
            image_project_id,
            "COMPLETED",
        )
        if not image_result["versions"][0]["asset_url"]:
            raise AssertionError("科研图片任务完成后没有受保护 asset")

        alignment_marker = uuid.uuid4().hex
        alignment_memory = expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories",
            201,
            {"body": f"对齐证据：优先保留可追溯来源 {alignment_marker}"},
        )
        expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{alignment_memory['id']}/share",
            200,
        )
        alignment = expect_status(
            alex,
            "POST",
            f"{public_url}/api/alignments",
            201,
            {
                "title": alignment_marker,
                "context": "验证候选观点、本人确认与正式决策",
                "participant_ids": [],
                **report_range,
            },
        )
        alex_position = next(
            position
            for position in alignment["positions"]
            if position["is_current_user"]
        )
        expect_status(
            blair,
            "POST",
            f"{public_url}/api/alignments/{alignment['id']}/positions/{alex_position['id']}/confirm",
            403,
            {"action": "CONFIRM"},
        )
        confirmed_position = expect_status(
            alex,
            "POST",
            f"{public_url}/api/alignments/{alignment['id']}/positions/{alex_position['id']}/confirm",
            200,
            {"action": "CONFIRM"},
        )
        if confirmed_position["status"] != "CONFIRMED":
            raise AssertionError("成员没有成功确认自己的观点")
        expect_status(
            blair,
            "POST",
            f"{public_url}/api/alignments/{alignment['id']}/decisions",
            403,
            {"decision": "越权决定", "rationale": "不应成功"},
        )
        decision = expect_status(
            alex,
            "POST",
            f"{public_url}/api/alignments/{alignment['id']}/decisions",
            201,
            {
                "decision": "保留证据并进入下一轮验证",
                "rationale": "只有 OWNER 可以发布，且必须保留成员观点快照。",
                "alternatives": ["继续收集证据"],
                "review_at": (now + timedelta(days=7)).isoformat(),
            },
        )
        decision_memory = expect_status(
            blair,
            "GET",
            f"{public_url}/api/memories/{decision['memory_id']}",
            200,
        )
        if decision_memory["visibility"] != "WORKSPACE":
            raise AssertionError("最终决策没有保存为团队记忆")
        expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{alignment_memory['id']}/unshare",
            200,
        )
        refreshed_alignment = expect_status(
            blair,
            "GET",
            f"{public_url}/api/alignments/{alignment['id']}",
            200,
        )
        refreshed_alex_position = next(
            position
            for position in refreshed_alignment["positions"]
            if position["user_id"] == created["author"]["id"]
        )
        if refreshed_alex_position["status"] != "NO_RECORDED_POSITION":
            raise AssertionError("来源撤权后对齐候选观点仍然可见")

        expect_status(
            alex,
            "POST",
            f"{public_url}/api/memories/{created_id}/unshare",
            200,
        )
        expect_status(blair, "GET", f"{public_url}/api/memories/{created_id}", 404)
        unshared_search = expect_status(blair, "POST", search_url, 200, {"q": marker})
        if any(
            result["memory"]["id"] == created_id
            for result in unshared_search["results"]
        ):
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
        expect_status(
            blair,
            "GET",
            f"{public_url}/api/reports/{shared_report['report_id']}",
            404,
        )
        expect_status(
            blair,
            "GET",
            f"{public_url}/api/visuals/{structured_project_id}",
            404,
        )
        for _ in range(20):
            processing = expect_status(
                alex,
                "GET",
                f"{public_url}/api/memories/{created_id}",
                200,
            )["processing_status"]
            if processing in {"COMPLETED", "WAITING_CONFIGURATION"}:
                break
            time.sleep(0.5)
        else:
            raise AssertionError("embedding worker 没有进入已完成或等待配置状态")
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
        if alex_personal_workspace_id is not None and personal_cleanup_ids:
            with suppress(AssertionError, HTTPError):
                expect_status(
                    alex,
                    "POST",
                    f"{public_url}/api/workspaces/{alex_personal_workspace_id}/activate",
                    200,
                )
            for personal_memory_id in personal_cleanup_ids:
                with suppress(AssertionError, HTTPError):
                    expect_status(
                        alex,
                        "DELETE",
                        f"{public_url}/api/memories/{personal_memory_id}",
                        204,
                    )
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

    print(f"Memora 记忆、报告、对齐与科研绘图关键路径通过：{public_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
