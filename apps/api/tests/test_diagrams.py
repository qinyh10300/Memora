from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def diagram_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="diagram-test-secret-not-for-production",
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


def _diagram_payload(memory_id: str, member_id: str, *, visibility: str) -> dict[str, object]:
    return {
        "title": "社会世界模型关系图",
        "kind": "MIND_MAP",
        "visibility": visibility,
        "nodes": [
            {
                "id": "memory-1",
                "kind": "MEMORY",
                "position": {"x": 0, "y": 0},
                "memory_id": memory_id,
            },
            {
                "id": "person-1",
                "kind": "PERSON",
                "position": {"x": 320, "y": 0},
                "user_id": member_id,
            },
            {
                "id": "note-1",
                "kind": "NOTE",
                "position": {"x": 160, "y": 180},
                "text": "共同验证",
            },
        ],
        "edges": [
            {
                "id": "edge-1",
                "source": "person-1",
                "target": "memory-1",
                "label": "提出",
            },
            {
                "id": "edge-2",
                "source": "memory-1",
                "target": "note-1",
                "label": "推进",
            },
        ],
    }


def test_diagram_visibility_and_memory_nodes_are_reauthorized_on_every_read(
    diagram_client: TestClient,
) -> None:
    alex = _login(diagram_client, "alex@memora.local", "memora-local-alex")
    blair = _login(diagram_client, "blair@memora.local", "memora-local-blair")
    member_id = next(
        member["id"]
        for member in diagram_client.get("/workspace/members", headers=alex).json()
        if member["display_name"] == "Blair"
    )
    memory = diagram_client.post(
        "/memories",
        headers=alex,
        json={"body": "# 社会世界模型\n\n先建立小范围验证。"},
    ).json()

    private_diagram = diagram_client.post(
        "/diagrams",
        headers=alex,
        json=_diagram_payload(memory["id"], member_id, visibility="PRIVATE"),
    )
    assert private_diagram.status_code == 201
    assert private_diagram.json()["is_owner"] is True
    assert private_diagram.json()["nodes"][0]["label"] == "社会世界模型"
    assert (
        diagram_client.get(f"/diagrams/{private_diagram.json()['id']}", headers=blair).status_code
        == 404
    )

    rejected_shared = diagram_client.post(
        "/diagrams",
        headers=alex,
        json=_diagram_payload(memory["id"], member_id, visibility="WORKSPACE"),
    )
    assert rejected_shared.status_code == 422
    assert "已共享" in rejected_shared.json()["detail"]

    assert diagram_client.post(f"/memories/{memory['id']}/share", headers=alex).status_code == 200
    shared_diagram = diagram_client.post(
        "/diagrams",
        headers=alex,
        json=_diagram_payload(memory["id"], member_id, visibility="WORKSPACE"),
    )
    assert shared_diagram.status_code == 201
    shared_id = shared_diagram.json()["id"]
    blair_view = diagram_client.get(f"/diagrams/{shared_id}", headers=blair)
    assert blair_view.status_code == 200
    assert blair_view.json()["is_owner"] is False
    assert blair_view.json()["nodes"][0]["author_name"] == "Alex"
    assert blair_view.json()["nodes"][0]["memory_id"] == memory["id"]

    assert diagram_client.post(f"/memories/{memory['id']}/unshare", headers=alex).status_code == 200
    redacted_view = diagram_client.get(f"/diagrams/{shared_id}", headers=blair).json()
    memory_node = next(node for node in redacted_view["nodes"] if node["kind"] == "MEMORY")
    assert memory_node["available"] is False
    assert memory_node["label"] == "来源已不可用"
    assert memory_node["memory_id"] is None
    assert "社会世界模型" not in str(memory_node)
    assert (
        diagram_client.put(
            f"/diagrams/{shared_id}",
            headers=blair,
            json=_diagram_payload(memory["id"], member_id, visibility="WORKSPACE"),
        ).status_code
        == 404
    )
    assert diagram_client.delete(f"/diagrams/{shared_id}", headers=blair).status_code == 404

    listed = diagram_client.get("/diagrams", headers=blair).json()
    assert [diagram["id"] for diagram in listed] == [shared_id]
    assert diagram_client.delete(f"/diagrams/{shared_id}", headers=alex).status_code == 204


def test_diagram_rejects_cross_workspace_references_and_invalid_edges(
    diagram_client: TestClient,
) -> None:
    alex = _login(diagram_client, "alex@memora.local", "memora-local-alex")
    memory = diagram_client.post(
        "/memories",
        headers=alex,
        json={"body": "旧空间中的私有记忆"},
    ).json()
    family = diagram_client.post(
        "/workspaces",
        headers=alex,
        json={"name": "家庭图谱", "kind": "FAMILY"},
    ).json()
    assert (
        diagram_client.post(f"/workspaces/{family['id']}/activate", headers=alex).status_code == 200
    )

    cross_workspace = diagram_client.post(
        "/diagrams",
        headers=alex,
        json={
            "title": "不允许的引用",
            "nodes": [
                {
                    "id": "memory-1",
                    "kind": "MEMORY",
                    "position": {"x": 0, "y": 0},
                    "memory_id": memory["id"],
                }
            ],
            "edges": [],
        },
    )
    assert cross_workspace.status_code == 422
    assert "无权访问" in cross_workspace.json()["detail"]

    invalid_edge = diagram_client.post(
        "/diagrams",
        headers=alex,
        json={
            "title": "断开的连线",
            "nodes": [
                {
                    "id": "note-1",
                    "kind": "NOTE",
                    "position": {"x": 0, "y": 0},
                    "text": "起点",
                }
            ],
            "edges": [{"id": "edge-1", "source": "note-1", "target": "missing"}],
        },
    )
    assert invalid_edge.status_code == 422
