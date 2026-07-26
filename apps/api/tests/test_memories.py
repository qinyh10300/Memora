from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.audit.models import AuditEvent
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.jobs.models import Job
from memora.main import create_app
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding
from memora.settings import Settings


@pytest.fixture
def memory_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="memory-test-secret-not-for-production",
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


def _create(
    client: TestClient,
    auth_headers: dict[str, str],
    body: str = "团队知识不该散落在每个人的文档里。",
    supersedes_id: str | None = None,
) -> dict[str, object]:
    payload: dict[str, str] = {"body": body}
    if supersedes_id is not None:
        payload["supersedes_id"] = supersedes_id
    response = client.post("/memories", headers=auth_headers, json=payload)
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def test_create_is_private_and_persists_outbox_in_same_commit(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    blair = _login(memory_client, "blair@memora.local", "memora-local-blair")

    created = _create(memory_client, alex, body="  先把记录摩擦降到十五秒。  ")
    memory_id = UUID(cast(str, created["id"]))

    assert created["body"] == "先把记录摩擦降到十五秒。"
    assert created["visibility"] == "PRIVATE"
    assert created["is_owner"] is True
    assert cast(dict[str, object], created["author"])["display_name"] == "Alex"
    assert created["shared_at"] is None
    assert created["processing_status"] == "PENDING"

    engine = cast(FastAPI, memory_client.app).state.engine
    with Session(engine) as database:
        stored = database.get(Memory, memory_id)
        projection = database.get(MemoryEmbedding, memory_id)
        job = database.scalar(select(Job).where(Job.payload_ref == memory_id))
        event = database.scalar(
            select(AuditEvent).where(
                AuditEvent.resource_id == memory_id,
                AuditEvent.action == "MEMORY_CREATED",
            )
        )

    assert stored is not None and stored.visibility == "PRIVATE"
    assert projection is not None and projection.status == "PENDING"
    assert job is not None and job.status == "PENDING" and job.type == "EMBED_MEMORY"
    assert event is not None
    assert not hasattr(event, "body")
    assert memory_client.get("/memories", headers=blair).json() == []
    assert memory_client.get(f"/memories/{memory_id}", headers=blair).status_code == 404


def test_share_and_unshare_apply_cross_user_permission_matrix(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    blair = _login(memory_client, "blair@memora.local", "memora-local-blair")
    created = _create(memory_client, alex)
    memory_id = cast(str, created["id"])

    share_response = memory_client.post(f"/memories/{memory_id}/share", headers=alex)
    assert share_response.status_code == 200
    assert share_response.json()["visibility"] == "WORKSPACE"
    assert share_response.json()["shared_at"] is not None

    repeated_share = memory_client.post(f"/memories/{memory_id}/share", headers=alex)
    assert repeated_share.status_code == 200
    assert repeated_share.json()["shared_at"] == share_response.json()["shared_at"]

    blair_list = memory_client.get("/memories", headers=blair).json()
    assert [item["id"] for item in blair_list] == [memory_id]
    assert blair_list[0]["is_owner"] is False
    assert memory_client.get(f"/memories/{memory_id}", headers=blair).status_code == 200
    assert memory_client.post(f"/memories/{memory_id}/share", headers=blair).status_code == 403
    assert memory_client.delete(f"/memories/{memory_id}", headers=blair).status_code == 403

    unshare_response = memory_client.post(f"/memories/{memory_id}/unshare", headers=alex)
    assert unshare_response.status_code == 200
    assert unshare_response.json()["visibility"] == "PRIVATE"
    assert unshare_response.json()["shared_at"] is None
    assert memory_client.get("/memories", headers=blair).json() == []
    assert memory_client.get(f"/memories/{memory_id}", headers=blair).status_code == 404
    assert memory_client.post(f"/memories/{memory_id}/unshare", headers=blair).status_code == 404

    engine = cast(FastAPI, memory_client.app).state.engine
    with Session(engine) as database:
        actions = database.scalars(
            select(AuditEvent.action)
            .where(AuditEvent.resource_id == UUID(memory_id))
            .order_by(AuditEvent.created_at)
        ).all()
    assert actions.count("MEMORY_SHARED") == 1
    assert actions.count("MEMORY_UNSHARED") == 1


def test_supplement_is_append_only_and_delete_clears_body(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    blair = _login(memory_client, "blair@memora.local", "memora-local-blair")
    original = _create(memory_client, alex, body="商业模式先按席位订阅。")
    original_id = cast(str, original["id"])
    supplement = _create(
        memory_client,
        alex,
        body="补充：小团队测试阶段先不收费。",
        supersedes_id=original_id,
    )

    assert supplement["supersedes_id"] == original_id
    assert (
        memory_client.get(f"/memories/{original_id}", headers=alex).json()["body"]
        == original["body"]
    )

    memory_client.post(f"/memories/{original_id}/share", headers=alex)
    memory_client.post(f"/memories/{supplement['id']}/share", headers=alex)
    blair_supplement = memory_client.get(f"/memories/{supplement['id']}", headers=blair).json()
    assert blair_supplement["supersedes_id"] is None
    invalid_supplement = memory_client.post(
        "/memories",
        headers=blair,
        json={"body": "试图补充别人的记录", "supersedes_id": original_id},
    )
    assert invalid_supplement.status_code == 422

    delete_response = memory_client.delete(f"/memories/{original_id}", headers=alex)
    assert delete_response.status_code == 204
    assert memory_client.get(f"/memories/{original_id}", headers=alex).status_code == 404
    assert memory_client.get(f"/memories/{original_id}", headers=blair).status_code == 404

    engine = cast(FastAPI, memory_client.app).state.engine
    with Session(engine) as database:
        stored = database.get(Memory, UUID(original_id))
        projection = database.get(MemoryEmbedding, UUID(original_id))
        job = database.scalar(select(Job).where(Job.payload_ref == UUID(original_id)))
        deleted_event = database.scalar(
            select(AuditEvent).where(
                AuditEvent.resource_id == UUID(original_id),
                AuditEvent.action == "MEMORY_DELETED",
            )
        )
    assert stored is not None and stored.body is None and stored.deleted_at is not None
    assert projection is None
    assert job is not None and job.status == "CANCELLED"
    assert deleted_event is not None


def test_list_filters_and_all_routes_require_authentication(memory_client: TestClient) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    created = _create(memory_client, alex)
    author_id = cast(str, cast(dict[str, object], created["author"])["id"])
    now = datetime.now(UTC)

    assert (
        len(memory_client.get("/memories", headers=alex, params={"author_id": author_id}).json())
        == 1
    )
    assert (
        memory_client.get("/memories", headers=alex, params={"visibility": "WORKSPACE"}).json()
        == []
    )
    assert (
        memory_client.get(
            "/memories",
            headers=alex,
            params={"from": (now + timedelta(minutes=1)).isoformat()},
        ).json()
        == []
    )
    assert (
        memory_client.get(
            "/memories",
            headers=alex,
            params={"to": (now + timedelta(minutes=1)).isoformat()},
        ).status_code
        == 200
    )

    memory_client.cookies.clear()
    assert memory_client.post("/memories", json={"body": "匿名记录"}).status_code == 401
    assert memory_client.get("/memories").status_code == 401
    assert memory_client.get(f"/memories/{created['id']}").status_code == 401
    assert memory_client.post(f"/memories/{created['id']}/share").status_code == 401
    assert memory_client.delete(f"/memories/{created['id']}").status_code == 401


def test_author_can_retry_failed_processing_but_other_users_cannot(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    blair = _login(memory_client, "blair@memora.local", "memora-local-blair")
    created = _create(memory_client, alex)
    memory_id = UUID(cast(str, created["id"]))
    engine = cast(FastAPI, memory_client.app).state.engine
    with Session(engine) as database, database.begin():
        job = database.scalar(select(Job).where(Job.payload_ref == memory_id))
        projection = database.get(MemoryEmbedding, memory_id)
        assert job is not None and projection is not None
        job.status = "FAILED"
        job.attempts = 5
        job.next_run_at = None
        job.last_error_code = "provider_timeout"
        projection.status = "FAILED"
        projection.last_error_code = "provider_timeout"

    assert (
        memory_client.post(f"/memories/{memory_id}/retry-processing", headers=blair).status_code
        == 404
    )
    retry_response = memory_client.post(f"/memories/{memory_id}/retry-processing", headers=alex)

    assert retry_response.status_code == 200
    assert retry_response.json()["processing_status"] == "PENDING"
    with Session(engine) as database:
        job = database.scalar(select(Job).where(Job.payload_ref == memory_id))
        projection = database.get(MemoryEmbedding, memory_id)
    assert job is not None and job.status == "PENDING" and job.attempts == 0
    assert job.next_run_at is not None and job.last_error_code is None
    assert projection is not None and projection.status == "PENDING"


def test_update_current_creates_hidden_immutable_revision_and_filters_retrieval(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    blair = _login(memory_client, "blair@memora.local", "memora-local-blair")
    original = _create(memory_client, alex, body="# 定价\n\n旧方案按项目收费。")
    original_id = cast(str, original["id"])

    response = memory_client.post(
        f"/memories/{original_id}/revisions",
        headers=alex,
        json={
            "body": "# 定价\n\n新方案按席位订阅。",
            "mode": "UPDATE_CURRENT",
        },
    )

    assert response.status_code == 201
    updated = response.json()
    assert updated["id"] != original_id
    assert updated["timeline_entry_id"] == original["timeline_entry_id"]
    assert updated["revision_kind"] == "UPDATE_CURRENT"
    assert updated["supersedes_id"] == original_id
    assert [item["id"] for item in memory_client.get("/memories", headers=alex).json()] == [
        updated["id"]
    ]
    assert memory_client.get(f"/memories/{original_id}", headers=alex).status_code == 404

    revisions = memory_client.get(
        f"/memories/{updated['id']}/revisions",
        headers=alex,
    )
    assert revisions.status_code == 200
    assert [item["body"] for item in revisions.json()] == [
        "# 定价\n\n新方案按席位订阅。",
        "# 定价\n\n旧方案按项目收费。",
    ]
    assert revisions.json()[1]["timeline_visible"] is False
    assert (
        memory_client.get(
            f"/memories/{updated['id']}/revisions",
            headers=blair,
        ).status_code
        == 404
    )

    old_search = memory_client.post("/search", headers=alex, json={"q": "项目收费"})
    assert old_search.status_code == 200
    assert old_search.json()["results"] == []
    current_search = memory_client.post("/search", headers=alex, json={"q": "席位订阅"})
    assert [item["memory"]["id"] for item in current_search.json()["results"]] == [updated["id"]]


def test_new_version_keeps_both_timeline_entries_and_delete_clears_only_its_lineage(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    original = _create(memory_client, alex, body="# 方向\n\n先验证个人记录。")
    original_id = cast(str, original["id"])

    new_version_response = memory_client.post(
        f"/memories/{original_id}/revisions",
        headers=alex,
        json={
            "body": "# 方向\n\n开始验证个人回顾。",
            "mode": "NEW_VERSION",
        },
    )

    assert new_version_response.status_code == 201
    new_version = new_version_response.json()
    assert new_version["timeline_entry_id"] == new_version["id"]
    assert new_version["revision_kind"] == "NEW_VERSION"
    listed_ids = {item["id"] for item in memory_client.get("/memories", headers=alex).json()}
    assert listed_ids == {original_id, new_version["id"]}

    updated_response = memory_client.post(
        f"/memories/{new_version['id']}/revisions",
        headers=alex,
        json={
            "body": "# 方向\n\n开始验证个人回顾，并观察连续使用率。",
            "mode": "UPDATE_CURRENT",
        },
    )
    assert updated_response.status_code == 201
    updated = updated_response.json()
    assert updated["timeline_entry_id"] == new_version["timeline_entry_id"]

    assert memory_client.delete(f"/memories/{updated['id']}", headers=alex).status_code == 204
    remaining = memory_client.get("/memories", headers=alex).json()
    assert [item["id"] for item in remaining] == [original_id]

    engine = cast(FastAPI, memory_client.app).state.engine
    with Session(engine) as database:
        deleted_revisions = database.scalars(
            select(Memory).where(
                Memory.timeline_entry_id == UUID(cast(str, new_version["timeline_entry_id"]))
            )
        ).all()
        original_memory = database.get(Memory, UUID(original_id))
        deleted_projections = database.scalars(
            select(MemoryEmbedding).where(
                MemoryEmbedding.memory_id.in_([item.id for item in deleted_revisions])
            )
        ).all()

    assert len(deleted_revisions) == 2
    assert all(item.body is None and item.deleted_at is not None for item in deleted_revisions)
    assert deleted_projections == []
    assert original_memory is not None and original_memory.body == "# 方向\n\n先验证个人记录。"


def test_revision_rejects_unchanged_or_stale_memory(
    memory_client: TestClient,
) -> None:
    alex = _login(memory_client, "alex@memora.local", "memora-local-alex")
    original = _create(memory_client, alex, body="# 原始内容")
    original_id = cast(str, original["id"])

    unchanged = memory_client.post(
        f"/memories/{original_id}/revisions",
        headers=alex,
        json={"body": "# 原始内容", "mode": "UPDATE_CURRENT"},
    )
    assert unchanged.status_code == 422

    updated = memory_client.post(
        f"/memories/{original_id}/revisions",
        headers=alex,
        json={"body": "# 更新内容", "mode": "UPDATE_CURRENT"},
    )
    assert updated.status_code == 201
    stale = memory_client.post(
        f"/memories/{original_id}/revisions",
        headers=alex,
        json={"body": "# 再次更新", "mode": "UPDATE_CURRENT"},
    )
    assert stale.status_code == 404
