from collections.abc import Iterator
from typing import cast

import pytest
from fastapi.testclient import TestClient

from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def conversation_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="conversation-test-secret-not-for-production",
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


def _start(client: TestClient, headers: dict[str, str]) -> dict[str, object]:
    response = client.post("/conversations", headers=headers, json={})
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def _ask(
    client: TestClient,
    headers: dict[str, str],
    conversation_id: str,
    question: str,
) -> dict[str, object]:
    response = client.post(
        "/chat/questions",
        headers=headers,
        json={
            "conversation_id": conversation_id,
            "question": question,
            "topic": "商业模式",
            "scope": "PERSONAL",
        },
    )
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_conversation_reuses_thread_and_restores_messages(
    conversation_client: TestClient,
) -> None:
    alex = _login(conversation_client, "alex@memora.local", "memora-local-alex")
    memory = conversation_client.post(
        "/memories",
        headers=alex,
        json={"body": "商业模式先验证团队订阅。"},
    ).json()
    conversation = _start(conversation_client, alex)
    conversation_id = cast(str, conversation["id"])

    first = _ask(
        conversation_client,
        alex,
        conversation_id,
        "我之前对商业模式怎么看？",
    )
    second = _ask(
        conversation_client,
        alex,
        conversation_id,
        "再总结一次商业模式。",
    )
    assert first["conversation_id"] == conversation_id
    assert second["conversation_id"] == conversation_id

    listed = conversation_client.get("/conversations", headers=alex).json()
    assert len(listed) == 1
    assert listed[0]["id"] == conversation_id
    assert listed[0]["title"] == "我之前对商业模式怎么看？"
    assert listed[0]["message_count"] == 4

    detail = conversation_client.get(f"/conversations/{conversation_id}", headers=alex)
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert [message["role"] for message in messages] == [
        "USER",
        "ASSISTANT",
        "USER",
        "ASSISTANT",
    ]
    assert [citation["memory_id"] for citation in messages[1]["citations"]] == [memory["id"]]
    assert [citation["memory_id"] for citation in messages[3]["citations"]] == [memory["id"]]


def test_capture_history_tracks_current_visibility_and_delete_redacts_body(
    conversation_client: TestClient,
) -> None:
    alex = _login(conversation_client, "alex@memora.local", "memora-local-alex")
    conversation = _start(conversation_client, alex)
    conversation_id = cast(str, conversation["id"])
    body = "记录删除后不能残留在 conversation 消息里。"
    created = conversation_client.post(
        "/memories",
        headers=alex,
        json={"body": body, "conversation_id": conversation_id},
    ).json()

    detail = conversation_client.get(f"/conversations/{conversation_id}", headers=alex).json()
    assert [message["content"] for message in detail["messages"]] == [body, "已保存。"]
    assert detail["messages"][0]["memory"]["visibility"] == "PRIVATE"
    assert detail["messages"][1]["memory"]["visibility"] == "PRIVATE"

    assert (
        conversation_client.post(f"/memories/{created['id']}/share", headers=alex).status_code
        == 200
    )
    shared = conversation_client.get(f"/conversations/{conversation_id}", headers=alex).json()
    assert shared["messages"][1]["memory"]["visibility"] == "WORKSPACE"

    assert conversation_client.delete(f"/memories/{created['id']}", headers=alex).status_code == 204
    deleted = conversation_client.get(f"/conversations/{conversation_id}", headers=alex).json()
    assert [message["content"] for message in deleted["messages"]] == [
        "这条记录已删除。",
        "这条记录已删除。",
    ]
    assert all(message["status"] == "REDACTED" for message in deleted["messages"])
    assert body not in str(deleted)


def test_conversation_ids_are_isolated_by_user_and_active_workspace(
    conversation_client: TestClient,
) -> None:
    alex = _login(conversation_client, "alex@memora.local", "memora-local-alex")
    team_conversation = _start(conversation_client, alex)
    team_conversation_id = cast(str, team_conversation["id"])

    created_workspace = conversation_client.post(
        "/workspaces",
        headers=alex,
        json={"name": "隔离验证空间"},
    ).json()
    assert (
        conversation_client.post(
            f"/workspaces/{created_workspace['id']}/activate",
            headers=alex,
        ).status_code
        == 200
    )
    other_conversation = _start(conversation_client, alex)
    other_conversation_id = cast(str, other_conversation["id"])
    assert (
        conversation_client.get(
            f"/conversations/{team_conversation_id}",
            headers=alex,
        ).status_code
        == 404
    )

    conversation_client.cookies.clear()
    blair = _login(conversation_client, "blair@memora.local", "memora-local-blair")
    assert (
        conversation_client.get(
            f"/conversations/{team_conversation_id}",
            headers=blair,
        ).status_code
        == 404
    )
    assert (
        conversation_client.patch(
            f"/conversations/{team_conversation_id}",
            headers=blair,
            json={"title": "越权修改"},
        ).status_code
        == 404
    )
    assert (
        conversation_client.post(
            "/chat/questions",
            headers=blair,
            json={
                "conversation_id": team_conversation_id,
                "question": "越权读取",
                "topic": "全部",
                "scope": "PERSONAL",
            },
        ).status_code
        == 404
    )
    assert (
        conversation_client.post(
            "/memories",
            headers=blair,
            json={"body": "越权写入", "conversation_id": team_conversation_id},
        ).status_code
        == 404
    )
    assert (
        conversation_client.get(
            f"/conversations/{other_conversation_id}",
            headers=blair,
        ).status_code
        == 404
    )


def test_archived_conversation_leaves_active_list_and_rejects_new_messages(
    conversation_client: TestClient,
) -> None:
    alex = _login(conversation_client, "alex@memora.local", "memora-local-alex")
    conversation = _start(conversation_client, alex)
    conversation_id = cast(str, conversation["id"])

    archived = conversation_client.patch(
        f"/conversations/{conversation_id}",
        headers=alex,
        json={"title": "已完成讨论", "archived": True},
    )
    assert archived.status_code == 200
    assert archived.json()["title"] == "已完成讨论"
    assert archived.json()["archived_at"] is not None
    assert conversation_client.get("/conversations", headers=alex).json() == []
    assert [
        item["id"]
        for item in conversation_client.get(
            "/conversations",
            headers=alex,
            params={"archived": True},
        ).json()
    ] == [conversation_id]
    assert (
        conversation_client.get(f"/conversations/{conversation_id}", headers=alex).status_code
        == 200
    )
    assert (
        conversation_client.post(
            "/memories",
            headers=alex,
            json={"body": "不能写入归档对话", "conversation_id": conversation_id},
        ).status_code
        == 404
    )
