from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from fastapi.testclient import TestClient

from memora.ai.ports import ChatMessage, ChatResult, ModelUsage
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def report_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="report-test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def _create(client: TestClient, headers: dict[str, str], body: str) -> dict[str, object]:
    response = client.post("/memories", headers=headers, json={"body": body})
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def _range() -> tuple[str, str]:
    now = datetime.now(UTC)
    return (now - timedelta(days=1)).isoformat(), (now + timedelta(days=1)).isoformat()


def _report(
    client: TestClient,
    headers: dict[str, str],
    *,
    scope: str = "PERSONAL",
    topic: str = "全部",
    author_id: str | None = None,
) -> dict[str, object]:
    created_from, created_to = _range()
    payload: dict[str, object] = {
        "scope": scope,
        "topic": topic,
        "created_from": created_from,
        "created_to": created_to,
        "evidence_limit": 20,
    }
    if author_id is not None:
        payload["author_id"] = author_id
    response = client.post("/reports", headers=headers, json=payload)
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_personal_report_includes_private_records_and_all_evidence_sections(
    report_client: TestClient,
) -> None:
    alex = _login(report_client, "alex@memora.local", "memora-local-alex")
    first = _create(report_client, alex, "商业模式最初考虑按席位订阅。")
    second = _create(report_client, alex, "商业模式补充：先验证持续记录率，再决定收费。")

    report = _report(report_client, alex, topic="商业模式")

    assert report["status"] == "GENERATED"
    assert report["model_status"] == "DISABLED"
    assert report["title"] == "我的想法报告 · 商业模式"
    citations = cast(list[dict[str, object]], report["citations"])
    assert {item["memory_id"] for item in citations} == {first["id"], second["id"]}
    assert all(
        cast(dict[str, object], item["author"])["display_name"] == "Alex" for item in citations
    )
    sections = cast(list[dict[str, object]], report["sections"])
    assert [section["kind"] for section in sections] == [
        "TIMELINE",
        "CONTINUITY",
        "CHANGES",
        "CONTRADICTIONS",
        "GAPS",
    ]
    assert "不自动等于观点一致" in cast(str, sections[1]["content"])
    assert "不会自动判定矛盾" in cast(str, sections[3]["content"])
    assert report["contributors"] == [
        {
            "author_id": cast(dict[str, object], first["author"])["id"],
            "display_name": "Alex",
            "record_count": 2,
        }
    ]


def test_colleague_and_team_reports_only_use_explicitly_shared_records(
    report_client: TestClient,
) -> None:
    alex = _login(report_client, "alex@memora.local", "memora-local-alex")
    blair = _login(report_client, "blair@memora.local", "memora-local-blair")
    private = _create(report_client, alex, "报告边界 PRIVATE_REPORT_SECRET")
    shared = _create(report_client, alex, "报告边界：这是 Alex 主动共享的进展。")
    blair_private = _create(report_client, blair, "报告边界 BLAIR_PRIVATE_TEAM_SECRET")
    assert report_client.post(f"/memories/{shared['id']}/share", headers=alex).status_code == 200
    alex_id = cast(str, cast(dict[str, object], shared["author"])["id"])

    colleague = _report(
        report_client,
        blair,
        scope="COLLEAGUE",
        topic="报告边界",
        author_id=alex_id,
    )
    colleague_citations = cast(list[dict[str, object]], colleague["citations"])
    colleague_ids = [item["memory_id"] for item in colleague_citations]
    assert colleague_ids == [shared["id"]]

    team = _report(report_client, blair, scope="WORKSPACE", topic="报告边界")
    team_citations = cast(list[dict[str, object]], team["citations"])
    team_ids = [item["memory_id"] for item in team_citations]
    assert team_ids == [shared["id"]]
    assert private["id"] not in team_ids
    assert blair_private["id"] not in team_ids

    assert report_client.post(f"/memories/{shared['id']}/unshare", headers=alex).status_code == 200
    after_unshare = _report(
        report_client,
        blair,
        scope="COLLEAGUE",
        topic="报告边界",
        author_id=alex_id,
    )
    assert after_unshare["status"] == "NO_EVIDENCE"
    assert after_unshare["citations"] == []
    assert "没有足够记录" in cast(str, after_unshare["summary"])


class CaptureReportModel:
    model_id = "capture-report"

    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        self.messages = messages
        return ChatResult(
            content="模型只基于共享证据生成的团队摘要。",
            model=self.model_id,
            usage=ModelUsage(input_tokens=40, output_tokens=12),
        )


def test_report_model_context_excludes_private_records(
    report_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    alex = _login(report_client, "alex@memora.local", "memora-local-alex")
    blair = _login(report_client, "blair@memora.local", "memora-local-blair")
    private = _create(report_client, alex, "模型报告 MODEL_PRIVATE_NEVER_SEND")
    shared = _create(report_client, alex, "模型报告：允许进入团队报告的证据。")
    assert report_client.post(f"/memories/{shared['id']}/share", headers=alex).status_code == 200
    model = CaptureReportModel()
    monkeypatch.setattr("memora.api.reports.build_chat_model", lambda _settings: model)

    report = _report(report_client, blair, scope="WORKSPACE", topic="模型报告")

    prompt = "\n".join(message.content for message in model.messages)
    assert "允许进入团队报告的证据" in prompt
    assert "MODEL_PRIVATE_NEVER_SEND" not in prompt
    assert str(private["id"]) not in prompt
    assert report["summary"] == "模型只基于共享证据生成的团队摘要。"
    assert report["model_status"] == "AVAILABLE"


def test_report_requires_explicit_valid_time_range(report_client: TestClient) -> None:
    alex = _login(report_client, "alex@memora.local", "memora-local-alex")
    now = datetime.now(UTC).isoformat()

    missing = report_client.post(
        "/reports",
        headers=alex,
        json={"scope": "PERSONAL", "topic": "全部"},
    )
    assert missing.status_code == 422

    reversed_range = report_client.post(
        "/reports",
        headers=alex,
        json={
            "scope": "PERSONAL",
            "topic": "全部",
            "created_from": now,
            "created_to": now,
            "evidence_limit": 20,
        },
    )
    assert reversed_range.status_code == 422
