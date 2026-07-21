from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.database import Base
from memora.identity.models import User
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.seed import seed_database, seed_users_from_settings, validate_seed_users
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def identity_client() -> Iterator[tuple[TestClient, Settings]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="identity-test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client, settings


def test_seed_creates_four_argon2_users_idempotently(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, settings = identity_client
    engine = cast(FastAPI, client.app).state.engine

    assert seed_database(engine, settings) == (0, 0)
    with Session(engine) as database:
        users = database.scalars(select(User).order_by(User.email)).all()

    assert len(users) == 4
    assert all(user.password_hash.startswith("$argon2id$") for user in users)


def test_login_cookie_me_members_and_logout(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client

    invalid_response = client.post(
        "/auth/login",
        json={"email": "alex@memora.local", "password": "wrong-password"},
    )
    assert invalid_response.status_code == 401
    assert invalid_response.json() == {"detail": "邮箱或密码错误"}

    login_response = client.post(
        "/auth/login",
        json={"email": " ALEX@memora.local ", "password": "memora-local-alex"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["display_name"] == "Alex"
    cookie_header = login_response.headers["set-cookie"].lower()
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    assert "path=/" in cookie_header

    me_response = client.get("/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "alex@memora.local"

    members_response = client.get("/workspace/members")
    assert members_response.status_code == 200
    members = members_response.json()
    assert [member["display_name"] for member in members] == ["Alex", "Blair", "Casey", "Devon"]
    assert all("email" not in member for member in members)

    logout_response = client.post("/auth/logout")
    assert logout_response.status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_protected_routes_reject_anonymous_users(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client

    assert client.get("/auth/me").status_code == 401
    assert client.get("/workspace/members").status_code == 401


def test_login_rate_limiter_has_a_fixed_window() -> None:
    limiter = LoginRateLimiter(maximum_attempts=2, window_seconds=10)

    assert limiter.consume("client", now=1)
    assert limiter.consume("client", now=2)
    assert not limiter.consume("client", now=3)
    assert limiter.consume("client", now=12)
    limiter.reset("client")
    assert limiter.consume("client", now=12)


def test_production_seed_rejects_local_passwords() -> None:
    settings = Settings(
        app_env="production",
        session_secret="production-test-session-secret-32-characters",
    )

    with pytest.raises(ValueError, match="explicit non-local passwords"):
        validate_seed_users(settings, seed_users_from_settings(settings))
