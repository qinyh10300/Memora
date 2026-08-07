from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from fastapi.testclient import TestClient

from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def alignment_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="alignment-test-secret-not-for-production",
        team_intelligence_enabled=True,
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


def _memory(
    client: TestClient,
    headers: dict[str, str],
    body: str,
    *,
    shared: bool,
) -> dict[str, object]:
    response = client.post("/memories", headers=headers, json={"body": body})
    assert response.status_code == 201
    memory = cast(dict[str, object], response.json())
    if shared:
        shared_response = client.post(f"/memories/{memory['id']}/share", headers=headers)
        assert shared_response.status_code == 200
        memory = cast(dict[str, object], shared_response.json())
    return memory


def _create_alignment(client: TestClient, headers: dict[str, str]) -> dict[str, object]:
    now = datetime.now(UTC)
    response = client.post(
        "/alignments",
        headers=headers,
        json={
            "title": "定价",
            "context": "确认下一阶段的收费验证方式",
            "created_from": (now - timedelta(days=1)).isoformat(),
            "created_to": (now + timedelta(days=1)).isoformat(),
        },
    )
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def test_alignment_candidates_only_use_shared_evidence_and_members_confirm_themselves(
    alignment_client: TestClient,
) -> None:
    alex = _login(alignment_client, "alex@memora.local", "memora-local-alex")
    blair = _login(alignment_client, "blair@memora.local", "memora-local-blair")
    _memory(
        alignment_client,
        alex,
        "定价 PRIVATE_ALIGNMENT_SECRET 不得进入候选观点。",
        shared=False,
    )
    alex_shared = _memory(
        alignment_client,
        alex,
        "定价建议先验证按席位订阅。",
        shared=True,
    )
    _memory(
        alignment_client,
        blair,
        "定价建议先做低门槛团队套餐。",
        shared=True,
    )

    topic = _create_alignment(alignment_client, alex)
    positions = cast(list[dict[str, object]], topic["positions"])
    combined = "\n".join(cast(str, position.get("text") or "") for position in positions)
    assert "按席位订阅" in combined
    assert "低门槛团队套餐" in combined
    assert "PRIVATE_ALIGNMENT_SECRET" not in combined

    alex_position = next(position for position in positions if position["display_name"] == "Alex")
    blair_position = next(position for position in positions if position["display_name"] == "Blair")
    forbidden = alignment_client.post(
        f"/alignments/{topic['id']}/positions/{alex_position['id']}/confirm",
        headers=blair,
        json={"action": "CONFIRM"},
    )
    assert forbidden.status_code == 403

    confirmed = alignment_client.post(
        f"/alignments/{topic['id']}/positions/{blair_position['id']}/confirm",
        headers=blair,
        json={"action": "CONFIRM"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CONFIRMED"

    assert (
        alignment_client.post(
            f"/memories/{alex_shared['id']}/unshare",
            headers=alex,
        ).status_code
        == 200
    )
    refreshed = alignment_client.get(f"/alignments/{topic['id']}", headers=blair)
    assert refreshed.status_code == 200
    refreshed_alex = next(
        position for position in refreshed.json()["positions"] if position["display_name"] == "Alex"
    )
    assert refreshed_alex["status"] == "NO_RECORDED_POSITION"
    assert refreshed_alex["text"] is None


def test_only_owner_publishes_immutable_decision_memory_with_position_snapshot(
    alignment_client: TestClient,
) -> None:
    alex = _login(alignment_client, "alex@memora.local", "memora-local-alex")
    blair = _login(alignment_client, "blair@memora.local", "memora-local-blair")
    _memory(alignment_client, alex, "定价采用按席位订阅。", shared=True)
    _memory(alignment_client, blair, "定价先保留免费团队试用。", shared=True)
    topic = _create_alignment(alignment_client, alex)

    denied = alignment_client.post(
        f"/alignments/{topic['id']}/decisions",
        headers=blair,
        json={"decision": "先试点", "rationale": "需要数据"},
    )
    assert denied.status_code == 403

    created = alignment_client.post(
        f"/alignments/{topic['id']}/decisions",
        headers=alex,
        json={
            "decision": "先进行一个月团队试点，再决定正式价格。",
            "rationale": "当前成员观点仍有差异，需要保留反对意见并采集数据。",
            "alternatives": ["立即按席位收费", "继续永久免费"],
            "review_at": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
        },
    )
    assert created.status_code == 201
    decision = created.json()
    assert len(decision["position_snapshot"]) >= 2

    memory = alignment_client.get(f"/memories/{decision['memory_id']}", headers=blair)
    assert memory.status_code == 200
    assert memory.json()["visibility"] == "WORKSPACE"
    assert "成员观点与保留意见" in memory.json()["body"]

    refreshed = alignment_client.get(f"/alignments/{topic['id']}", headers=alex)
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "DECIDED"
    assert refreshed.json()["decisions"][0]["memory_id"] == decision["memory_id"]
