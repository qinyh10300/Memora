from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.reports.worker import process_due_report_subscription
from memora.settings import Settings


@pytest.fixture
def subscription_client() -> Iterator[tuple[TestClient, FastAPI, Settings]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="report-subscription-test-not-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client, app, settings


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def test_due_subscription_generates_persistent_report_from_shared_sources(
    subscription_client: tuple[TestClient, FastAPI, Settings],
) -> None:
    client, app, settings = subscription_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    private = client.post(
        "/memories",
        headers=alex,
        json={"body": "会前简报 SCHEDULE_PRIVATE_NEVER_INCLUDE"},
    ).json()
    shared = client.post(
        "/memories",
        headers=alex,
        json={"body": "会前简报：团队已确认下周完成试点。"},
    ).json()
    assert client.post(f"/memories/{shared['id']}/share", headers=alex).status_code == 200
    now = datetime.now(UTC)
    created = client.post(
        "/report-subscriptions",
        headers=alex,
        json={
            "preset": "MEETING",
            "scope": "WORKSPACE",
            "topic": "会前简报",
            "visibility": "PRIVATE",
            "cadence": "WEEKLY",
            "next_run_at": (now - timedelta(minutes=1)).isoformat(),
        },
    )
    assert created.status_code == 201

    assert process_due_report_subscription(app.state.engine, settings, now=now) is True

    subscriptions = client.get("/report-subscriptions", headers=alex)
    assert subscriptions.status_code == 200
    subscription = subscriptions.json()[0]
    assert subscription["last_report_id"] is not None
    assert subscription["last_error_code"] is None
    reports = client.get("/reports", headers=alex)
    assert reports.status_code == 200
    report = next(
        item for item in reports.json() if item["report_id"] == subscription["last_report_id"]
    )
    citation_ids = {citation["memory_id"] for citation in report["citations"]}
    assert shared["id"] in citation_ids
    assert private["id"] not in citation_ids
    assert "SCHEDULE_PRIVATE_NEVER_INCLUDE" not in report["summary"]


def test_paused_subscription_is_not_claimed(
    subscription_client: tuple[TestClient, FastAPI, Settings],
) -> None:
    client, app, settings = subscription_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    now = datetime.now(UTC)
    created = client.post(
        "/report-subscriptions",
        headers=alex,
        json={
            "preset": "MISSED",
            "scope": "PERSONAL",
            "visibility": "PRIVATE",
            "cadence": "DAILY",
            "next_run_at": (now - timedelta(minutes=1)).isoformat(),
        },
    )
    assert created.status_code == 201
    subscription_id = cast(dict[str, object], created.json())["id"]
    paused = client.patch(
        f"/report-subscriptions/{subscription_id}",
        headers=alex,
        json={"status": "PAUSED"},
    )
    assert paused.status_code == 200
    assert process_due_report_subscription(app.state.engine, settings, now=now) is False
