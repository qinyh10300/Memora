from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.billing.models import CreditLedgerEntry, CreditReservation, Subscription
from memora.billing.service import (
    InsufficientCreditsError,
    consume_credits,
    get_or_create_subscription,
    release_credit_reservation,
    reserve_credits,
    settle_credit_reservation,
)
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def billing_client() -> Iterator[tuple[TestClient, FastAPI]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="billing-test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client, app


def _login(
    client: TestClient, email: str, password: str
) -> tuple[dict[str, str], dict[str, object]]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}, cast(dict[str, object], response.json())


def test_plus_subscription_is_created_with_append_only_grant(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, _app = billing_client
    alex, _user = _login(client, "alex@memora.local", "memora-local-alex")

    subscription = client.get("/billing/subscription", headers=alex)
    assert subscription.status_code == 200
    assert subscription.json()["plan_code"] == "PLUS"
    assert subscription.json()["credits_granted"] == 2_000
    assert subscription.json()["credits_remaining"] == 2_000

    plans = client.get("/billing/plans", headers=alex).json()
    assert [plan["code"] for plan in plans] == ["PLUS", "PRO", "ULTRA"]
    assert [plan["is_current"] for plan in plans] == [True, False, False]
    ledger = client.get("/billing/credits", headers=alex).json()
    assert [(entry["reason"], entry["delta"], entry["balance_after"]) for entry in ledger] == [
        ("PERIOD_GRANT", 2_000, 2_000)
    ]


def test_upgrade_is_persistent_idempotent_and_cannot_downgrade(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, _app = billing_client
    alex, _user = _login(client, "alex@memora.local", "memora-local-alex")

    upgraded = client.post(
        "/billing/subscription/upgrade",
        headers=alex,
        json={"plan_code": "PRO"},
    )
    assert upgraded.status_code == 200
    assert upgraded.json()["credits_remaining"] == 10_000
    repeated = client.post(
        "/billing/subscription/upgrade",
        headers=alex,
        json={"plan_code": "PRO"},
    )
    assert repeated.status_code == 200
    assert len(client.get("/billing/credits", headers=alex).json()) == 2

    downgrade = client.post(
        "/billing/subscription/upgrade",
        headers=alex,
        json={"plan_code": "PLUS"},
    )
    assert downgrade.status_code == 409
    assert client.get("/billing/subscription", headers=alex).json()["plan_code"] == "PRO"


def test_credits_are_user_isolated_and_consumption_is_idempotent(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = billing_client
    alex, alex_user = _login(client, "alex@memora.local", "memora-local-alex")
    alex_id = UUID(cast(str, alex_user["id"]))
    client.cookies.clear()
    blair, _blair_user = _login(client, "blair@memora.local", "memora-local-blair")

    with Session(app.state.engine) as database, database.begin():
        consume_credits(
            database,
            alex_id,
            10,
            idempotency_key="draft:test-execution",
            reference_type="AGENT_EXECUTION",
            reference_id="test-execution",
        )
    with Session(app.state.engine) as database, database.begin():
        consume_credits(
            database,
            alex_id,
            10,
            idempotency_key="draft:test-execution",
            reference_type="AGENT_EXECUTION",
            reference_id="test-execution",
        )

    assert client.get("/billing/subscription", headers=alex).json()["credits_remaining"] == 1_990
    assert client.get("/billing/subscription", headers=blair).json()["credits_remaining"] == 2_000
    assert len(client.get("/billing/credits", headers=alex).json()) == 2


def test_period_refresh_and_insufficient_balance_are_safe(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = billing_client
    _headers, user = _login(client, "alex@memora.local", "memora-local-alex")
    user_id = UUID(cast(str, user["id"]))
    now = datetime.now(UTC)

    with Session(app.state.engine) as database, database.begin():
        subscription = get_or_create_subscription(database, user_id, now=now)
        subscription.credits_used = 1_995
        subscription.period_ends_at = now + timedelta(days=1)
    with (
        Session(app.state.engine) as database,
        database.begin(),
        pytest.raises(InsufficientCreditsError),
    ):
        consume_credits(
            database,
            user_id,
            10,
            idempotency_key="draft:insufficient",
            reference_type="AGENT_EXECUTION",
            reference_id="insufficient",
        )

    with Session(app.state.engine) as database, database.begin():
        expiring_subscription = database.scalar(
            select(Subscription).where(Subscription.user_id == user_id)
        )
        assert expiring_subscription is not None
        expiring_subscription.period_ends_at = now - timedelta(seconds=1)
    with Session(app.state.engine) as database, database.begin():
        refreshed = get_or_create_subscription(database, user_id, now=now)
        assert refreshed.credits_used == 0
        assert refreshed.credits_granted == 2_000
        reasons = database.scalars(
            select(CreditLedgerEntry.reason)
            .where(CreditLedgerEntry.user_id == user_id)
            .order_by(CreditLedgerEntry.created_at)
        ).all()
        assert reasons == ["PERIOD_GRANT", "PERIOD_RESET"]


def test_credit_reservation_is_idempotent_and_settles_without_double_charging(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = billing_client
    headers, user = _login(client, "alex@memora.local", "memora-local-alex")
    user_id = UUID(cast(str, user["id"]))

    with Session(app.state.engine) as database, database.begin():
        first = reserve_credits(
            database,
            user_id,
            120,
            idempotency_key="visual:test-job",
            reference_type="VISUAL_GENERATION_JOB",
            reference_id="test-job",
        )
        reservation_id = first.id
    with Session(app.state.engine) as database, database.begin():
        repeated = reserve_credits(
            database,
            user_id,
            120,
            idempotency_key="visual:test-job",
            reference_type="VISUAL_GENERATION_JOB",
            reference_id="test-job",
        )
        assert repeated.id == reservation_id

    reserved = client.get("/billing/subscription", headers=headers).json()
    assert reserved["credits_reserved"] == 120
    assert reserved["credits_remaining"] == 1_880

    with Session(app.state.engine) as database, database.begin():
        settle_credit_reservation(database, reservation_id)
    with Session(app.state.engine) as database, database.begin():
        settle_credit_reservation(database, reservation_id)

    settled = client.get("/billing/subscription", headers=headers).json()
    assert settled["credits_reserved"] == 0
    assert settled["credits_used"] == 120
    assert settled["credits_remaining"] == 1_880
    with Session(app.state.engine) as database:
        reservation = database.get(CreditReservation, reservation_id)
        assert reservation is not None and reservation.status == "SETTLED"


def test_releasing_credit_reservation_restores_available_balance(
    billing_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = billing_client
    headers, user = _login(client, "alex@memora.local", "memora-local-alex")
    user_id = UUID(cast(str, user["id"]))
    with Session(app.state.engine) as database, database.begin():
        reservation = reserve_credits(
            database,
            user_id,
            90,
            idempotency_key="visual:release-job",
            reference_type="VISUAL_GENERATION_JOB",
            reference_id="release-job",
        )
        reservation_id = reservation.id
    with Session(app.state.engine) as database, database.begin():
        release_credit_reservation(database, reservation_id)

    subscription = client.get("/billing/subscription", headers=headers).json()
    assert subscription["credits_reserved"] == 0
    assert subscription["credits_used"] == 0
    assert subscription["credits_remaining"] == 2_000
