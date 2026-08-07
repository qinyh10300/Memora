import base64
from collections.abc import Iterator
from typing import cast
from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.audit.models import AuditEvent
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.models import User, UserSession
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.seed import main as seed_main
from memora.identity.seed import seed_database, seed_users_from_settings, validate_seed_users
from memora.main import create_app
from memora.settings import Settings
from memora.workspaces.models import Workspace, WorkspaceJoinRequest, WorkspaceMembership


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


def test_seed_cli_is_a_noop_without_explicit_opt_in() -> None:
    settings = Settings(
        app_env="development",
        database_url="postgresql+psycopg://must-not-connect",
        session_secret="seed-cli-test-secret",
        seed_development_data_enabled=False,
    )

    with (
        patch("memora.identity.seed.get_settings", return_value=settings),
        patch("memora.identity.seed.build_engine") as build_engine,
    ):
        assert seed_main() == 0

    build_engine.assert_not_called()


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


def test_register_creates_isolated_personal_workspace_and_persistent_login(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    credentials = {
        "display_name": "  Lin   Yue  ",
        "email": " Lin.Yue@Example.com ",
        "password": "memora-new-account-2026",
    }

    registered = client.post("/auth/register", json=credentials)
    assert registered.status_code == 201
    assert registered.json() == {
        "id": registered.json()["id"],
        "email": "lin.yue@example.com",
        "display_name": "Lin Yue",
        "avatar_url": None,
        "workspace_id": registered.json()["workspace_id"],
        "workspace_name": "Lin Yue 的个人空间",
        "role": "OWNER",
    }
    assert "httponly" in registered.headers["set-cookie"].lower()
    assert client.get("/auth/me").json()["email"] == "lin.yue@example.com"

    workspaces = client.get("/workspaces").json()
    assert [(item["kind"], item["name"], item["is_current"]) for item in workspaces] == [
        ("PERSONAL", "Lin Yue 的个人空间", True)
    ]
    assert [member["display_name"] for member in client.get("/workspace/members").json()] == [
        "Lin Yue"
    ]

    engine = cast(FastAPI, client.app).state.engine
    with Session(engine) as database:
        user = database.scalar(select(User).where(User.email == "lin.yue@example.com"))
        assert user is not None and user.password_hash.startswith("$argon2id$")
        membership = database.scalar(
            select(WorkspaceMembership).where(WorkspaceMembership.user_id == user.id)
        )
        assert membership is not None and membership.role == "OWNER"
        workspace = database.get(Workspace, membership.workspace_id)
        assert workspace is not None and workspace.kind == "PERSONAL"
        assert database.scalar(
            select(AuditEvent).where(
                AuditEvent.actor_id == user.id,
                AuditEvent.action == "ACCOUNT_REGISTERED",
            )
        )

    duplicate = client.post("/auth/register", json=credentials)
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "该邮箱已注册"}

    assert client.post("/auth/logout").status_code == 204
    login = client.post(
        "/auth/login",
        json={"email": credentials["email"], "password": credentials["password"]},
    )
    assert login.status_code == 200
    assert login.json()["workspace_name"] == "Lin Yue 的个人空间"


def test_register_rejects_invalid_email_and_short_password(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client

    invalid_email = client.post(
        "/auth/register",
        json={"display_name": "Lin", "email": "not-an-email", "password": "long-enough-2026"},
    )
    assert invalid_email.status_code == 422
    assert invalid_email.json() == {"detail": "请输入有效邮箱"}

    short_password = client.post(
        "/auth/register",
        json={"display_name": "Lin", "email": "lin@example.com", "password": "short"},
    )
    assert short_password.status_code == 422


def test_profile_name_and_protected_avatar_persist(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    assert (
        client.post(
            "/auth/login",
            json={"email": "alex@memora.local", "password": "memora-local-alex"},
        ).status_code
        == 200
    )

    profile = client.patch("/auth/profile", json={"display_name": "  Alex   Chen  "})
    assert profile.status_code == 200
    assert profile.json()["display_name"] == "Alex Chen"
    assert client.get("/auth/me").json()["display_name"] == "Alex Chen"
    assert "Alex Chen 的个人空间" in [
        workspace["name"] for workspace in client.get("/workspaces").json()
    ]

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    avatar = client.put(
        "/auth/avatar",
        json={
            "name": "alex.png",
            "media_type": "image/png",
            "data": base64.b64encode(png).decode(),
        },
    )
    assert avatar.status_code == 200
    avatar_url = avatar.json()["avatar_url"]
    assert avatar_url.startswith("/api/auth/avatar/")
    assert client.get("/auth/me").json()["avatar_url"] == avatar_url

    content = client.get(avatar_url.removeprefix("/api"))
    assert content.status_code == 200
    assert content.content == png
    assert content.headers["cache-control"] == "private, no-store"

    alex_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert alex_token is not None
    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "blair@memora.local", "password": "memora-local-blair"},
        ).status_code
        == 200
    )
    assert client.get(avatar_url.removeprefix("/api")).status_code == 404

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    removed = client.delete("/auth/avatar")
    assert removed.status_code == 200
    assert removed.json()["avatar_url"] is None
    assert client.get(avatar_url.removeprefix("/api")).status_code == 404


def test_password_change_keeps_current_session_and_revokes_others(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    credentials = {"email": "alex@memora.local", "password": "memora-local-alex"}
    assert client.post("/auth/login", json=credentials).status_code == 200
    first_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert first_token is not None

    client.cookies.clear()
    assert client.post("/auth/login", json=credentials).status_code == 200
    current_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert current_token is not None and current_token != first_token

    wrong = client.put(
        "/auth/password",
        json={"current_password": "not-the-password", "new_password": "a-new-password-2026"},
    )
    assert wrong.status_code == 400
    assert wrong.json() == {"detail": "当前密码不正确"}

    changed = client.put(
        "/auth/password",
        json={"current_password": credentials["password"], "new_password": "a-new-password-2026"},
    )
    assert changed.status_code == 204
    assert client.get("/auth/me").status_code == 200

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, first_token)
    assert client.get("/auth/me").status_code == 401

    client.cookies.clear()
    assert client.post("/auth/login", json=credentials).status_code == 401
    assert (
        client.post(
            "/auth/login",
            json={"email": credentials["email"], "password": "a-new-password-2026"},
        ).status_code
        == 200
    )

    engine = cast(FastAPI, client.app).state.engine
    with Session(engine) as database:
        sessions = database.scalars(
            select(UserSession)
            .join(User, User.id == UserSession.user_id)
            .where(User.email == credentials["email"])
        ).all()
    assert any(session.revoked_at is not None for session in sessions)


def test_workspace_list_create_activate_and_membership_isolation(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    assert (
        client.post(
            "/auth/login",
            json={"email": "alex@memora.local", "password": "memora-local-alex"},
        ).status_code
        == 200
    )

    workspaces = client.get("/workspaces")
    assert workspaces.status_code == 200
    workspace_rows = workspaces.json()
    assert [(item["kind"], item["name"]) for item in workspace_rows] == [
        ("PERSONAL", "Alex 的个人空间"),
        ("TEAM", "Memora 测试工作区"),
    ]
    assert [item["name"] for item in workspace_rows if item["is_current"]] == ["Memora 测试工作区"]

    created = client.post("/workspaces", json={"name": "  Futura   Lab  "})
    assert created.status_code == 201
    created_workspace = created.json()
    assert created_workspace["name"] == "Futura Lab"
    assert created_workspace["kind"] == "TEAM"
    assert created_workspace["role"] == "OWNER"
    assert created_workspace["is_current"] is False

    activated = client.post(f"/workspaces/{created_workspace['id']}/activate")
    assert activated.status_code == 200
    assert activated.json()["is_current"] is True
    assert client.get("/auth/me").json()["workspace_name"] == "Futura Lab"
    assert [member["display_name"] for member in client.get("/workspace/members").json()] == [
        "Alex"
    ]

    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "blair@memora.local", "password": "memora-local-blair"},
        ).status_code
        == 200
    )
    blair_workspaces = client.get("/workspaces").json()
    assert "Futura Lab" not in [item["name"] for item in blair_workspaces]
    assert client.post(f"/workspaces/{created_workspace['id']}/activate").status_code == 404
    assert client.get("/auth/me").json()["workspace_name"] == "Memora 测试工作区"


def test_team_code_join_owner_invite_and_member_directory(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    assert (
        client.post(
            "/auth/login",
            json={"email": "alex@memora.local", "password": "memora-local-alex"},
        ).status_code
        == 200
    )

    created = client.post("/workspaces", json={"name": "Collective Intelligence Lab"})
    assert created.status_code == 201
    team = created.json()
    assert team["kind"] == "TEAM"
    assert len(team["join_code"]) == 12
    assert team["join_code"].isalnum()
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 200
    alex_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert alex_token is not None

    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "blair@memora.local", "password": "memora-local-blair"},
        ).status_code
        == 200
    )
    blair_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert blair_token is not None
    pending_blair = client.post("/workspaces/join", json={"code": team["join_code"]})
    assert pending_blair.status_code == 200
    assert pending_blair.json()["status"] == "PENDING"
    assert pending_blair.json()["workspace"] is None
    assert pending_blair.json()["join_request"]["workspace_name"] == team["name"]
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 404

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    assert [item["display_name"] for item in client.get("/workspace/join-requests").json()] == [
        "Blair"
    ]

    invited = client.post(
        f"/workspaces/{team['id']}/members",
        json={"email": " BLAIR@memora.local "},
    )
    assert invited.status_code == 201
    assert invited.json()["display_name"] == "Blair"
    assert invited.json()["role"] == "MEMBER"
    assert invited.json()["is_current_user"] is False
    assert "email" not in invited.json()
    assert client.get("/workspace/join-requests").json() == []
    assert (
        client.post(
            f"/workspaces/{team['id']}/members",
            json={"email": "blair@memora.local"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/workspaces/{team['id']}/members",
            json={"email": "missing@example.com"},
        ).status_code
        == 404
    )
    members = client.get("/workspace/members").json()
    assert [(member["display_name"], member["role"]) for member in members] == [
        ("Alex", "OWNER"),
        ("Blair", "MEMBER"),
    ]
    assert [member["display_name"] for member in members if member["is_current_user"]] == ["Alex"]

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, blair_token)
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 200
    assert (
        client.post(
            f"/workspaces/{team['id']}/members",
            json={"email": "casey@memora.local"},
        ).status_code
        == 403
    )

    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "casey@memora.local", "password": "memora-local-casey"},
        ).status_code
        == 200
    )
    casey_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert casey_token is not None
    formatted_code = f"{team['join_code'][:6]}-{team['join_code'][6:]}".lower()
    joined = client.post("/workspaces/join", json={"code": formatted_code})
    assert joined.status_code == 200
    assert joined.json()["status"] == "PENDING"
    assert joined.json()["join_request"]["workspace_id"] == team["id"]
    assert client.get("/auth/me").json()["workspace_name"] == "Memora 测试工作区"
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 404

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    requests = client.get("/workspace/join-requests")
    assert requests.status_code == 200
    assert [item["display_name"] for item in requests.json()] == ["Casey"]
    approved = client.post(f"/workspace/join-requests/{requests.json()[0]['user_id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["display_name"] == "Casey"

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, casey_token)
    assert client.get("/auth/me").json()["workspace_name"] == "Memora 测试工作区"
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 200
    assert [member["display_name"] for member in client.get("/workspace/members").json()] == [
        "Alex",
        "Blair",
        "Casey",
    ]
    active_join = client.post("/workspaces/join", json={"code": team["join_code"]})
    assert active_join.status_code == 200
    assert active_join.json()["status"] == "ACTIVE"
    assert active_join.json()["workspace"]["id"] == team["id"]
    assert client.post("/workspaces/join", json={"code": "AAAAAA-BBBBBB"}).status_code == 404

    personal = next(
        workspace
        for workspace in client.get("/workspaces").json()
        if workspace["kind"] == "PERSONAL"
    )
    assert client.post(f"/workspaces/{personal['id']}/activate").status_code == 200
    assert (
        client.post(
            f"/workspaces/{personal['id']}/members",
            json={"email": "devon@memora.local"},
        ).status_code
        == 422
    )

    engine = cast(FastAPI, client.app).state.engine
    with Session(engine) as database:
        team_row = database.get(Workspace, UUID(team["id"]))
        casey = database.scalar(select(User).where(User.email == "casey@memora.local"))
        assert team_row is not None and team_row.join_code == team["join_code"]
        assert casey is not None
        casey_membership = database.get(
            WorkspaceMembership,
            {"workspace_id": team_row.id, "user_id": casey.id},
        )
        casey_request = database.get(
            WorkspaceJoinRequest,
            {"workspace_id": team_row.id, "user_id": casey.id},
        )
        actions = database.scalars(
            select(AuditEvent.action).where(AuditEvent.workspace_id == team_row.id)
        ).all()
    assert casey_membership is not None and casey_membership.role == "MEMBER"
    assert casey_request is not None and casey_request.status == "APPROVED"
    assert "WORKSPACE_MEMBER_INVITED" in actions
    assert "WORKSPACE_JOIN_REQUESTED" in actions
    assert "WORKSPACE_JOIN_APPROVED" in actions


def test_team_owner_rejects_reopened_request_and_removes_member(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    assert (
        client.post(
            "/auth/login",
            json={"email": "alex@memora.local", "password": "memora-local-alex"},
        ).status_code
        == 200
    )
    team = client.post("/workspaces", json={"name": "Moderated Team"}).json()
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 200
    alex_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert alex_token is not None

    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "casey@memora.local", "password": "memora-local-casey"},
        ).status_code
        == 200
    )
    casey_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert casey_token is not None
    assert client.post("/workspaces/join", json={"code": team["join_code"]}).json()["status"] == (
        "PENDING"
    )

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    request_row = client.get("/workspace/join-requests").json()[0]
    rejected = client.post(f"/workspace/join-requests/{request_row['user_id']}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "REJECTED"
    assert client.get("/workspace/join-requests").json() == []

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, casey_token)
    reapplied = client.post("/workspaces/join", json={"code": team["join_code"]})
    assert reapplied.status_code == 200
    assert reapplied.json()["status"] == "PENDING"

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    request_row = client.get("/workspace/join-requests").json()[0]
    assert (
        client.post(f"/workspace/join-requests/{request_row['user_id']}/approve").status_code == 200
    )

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, casey_token)
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 200
    assert client.delete(f"/workspace/members/{request_row['user_id']}").status_code == 403

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, alex_token)
    alex_id = next(
        member["id"]
        for member in client.get("/workspace/members").json()
        if member["is_current_user"]
    )
    assert client.delete(f"/workspace/members/{alex_id}").status_code == 422
    assert client.delete(f"/workspace/members/{request_row['user_id']}").status_code == 204

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, casey_token)
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["workspace_name"] == "Casey 的个人空间"
    assert team["id"] not in [workspace["id"] for workspace in client.get("/workspaces").json()]
    assert client.post(f"/workspaces/{team['id']}/activate").status_code == 404


def test_family_workspace_reuses_invitation_and_membership_boundaries(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client
    assert (
        client.post(
            "/auth/login",
            json={"email": "alex@memora.local", "password": "memora-local-alex"},
        ).status_code
        == 200
    )

    created = client.post(
        "/workspaces",
        json={"name": "Alex 的家庭", "kind": "FAMILY"},
    )
    assert created.status_code == 201
    family = created.json()
    assert family["kind"] == "FAMILY"
    assert len(family["join_code"]) == 12
    assert client.post(f"/workspaces/{family['id']}/activate").status_code == 200

    invited = client.post(
        f"/workspaces/{family['id']}/members",
        json={"email": "blair@memora.local"},
    )
    assert invited.status_code == 201
    assert invited.json()["display_name"] == "Blair"
    assert [member["display_name"] for member in client.get("/workspace/members").json()] == [
        "Alex",
        "Blair",
    ]

    client.cookies.clear()
    assert (
        client.post(
            "/auth/login",
            json={"email": "blair@memora.local", "password": "memora-local-blair"},
        ).status_code
        == 200
    )
    assert client.post(f"/workspaces/{family['id']}/activate").status_code == 200
    assert client.get("/auth/me").json()["workspace_name"] == "Alex 的家庭"
    assert (
        client.post(
            f"/workspaces/{family['id']}/members",
            json={"email": "casey@memora.local"},
        ).status_code
        == 403
    )


def test_protected_routes_reject_anonymous_users(
    identity_client: tuple[TestClient, Settings],
) -> None:
    client, _settings = identity_client

    assert client.get("/auth/me").status_code == 401
    assert client.get("/workspaces").status_code == 401
    assert client.post("/workspaces", json={"name": "匿名空间"}).status_code == 401
    assert client.post("/workspaces/join", json={"code": "AAAAAABBBBBB"}).status_code == 401
    assert (
        client.post(
            "/workspaces/00000000-0000-0000-0000-000000000000/members",
            json={"email": "someone@example.com"},
        ).status_code
        == 401
    )
    assert client.get("/workspace/members").status_code == 401
    assert client.get("/workspace/join-requests").status_code == 401
    assert (
        client.post(
            "/workspace/join-requests/00000000-0000-0000-0000-000000000000/approve"
        ).status_code
        == 401
    )
    assert (
        client.delete("/workspace/members/00000000-0000-0000-0000-000000000000").status_code == 401
    )


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
