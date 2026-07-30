import base64
from collections.abc import Iterator
from typing import cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from memora.assets.models import Asset
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


@pytest.fixture
def asset_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="asset-test-secret-not-for-production",
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


def _png_base64() -> str:
    return base64.b64encode(b"\x89PNG\r\n\x1a\nasset-test").decode()


def test_image_asset_is_private_then_follows_shared_memory_reference(
    asset_client: TestClient,
) -> None:
    alex = _login(asset_client, "alex@memora.local", "memora-local-alex")
    blair = _login(asset_client, "blair@memora.local", "memora-local-blair")

    upload = asset_client.post(
        "/assets",
        headers=alex,
        json={
            "name": "whiteboard.png",
            "media_type": "image/png",
            "data": _png_base64(),
        },
    )
    assert upload.status_code == 201
    asset = upload.json()
    asset_id = asset["id"]
    assert asset["kind"] == "IMAGE"
    assert asset["markdown_url"] == f"/api/assets/{asset_id}/content"

    private_read = asset_client.get(f"/assets/{asset_id}/content", headers=alex)
    assert private_read.status_code == 200
    assert private_read.headers["content-type"].startswith("image/png")
    assert private_read.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert asset_client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 404

    memory = asset_client.post(
        "/memories",
        headers=alex,
        json={"body": f"# 白板\n\n![白板](/api/assets/{asset_id}/content)"},
    )
    assert memory.status_code == 201
    memory_id = memory.json()["id"]
    assert asset_client.post(f"/memories/{memory_id}/share", headers=alex).status_code == 200
    assert asset_client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 200

    assert asset_client.post(f"/memories/{memory_id}/unshare", headers=alex).status_code == 200
    assert asset_client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 404
    assert asset_client.delete(f"/memories/{memory_id}", headers=alex).status_code == 204
    assert asset_client.get(f"/assets/{asset_id}/content", headers=alex).status_code == 404

    with Session(cast(FastAPI, asset_client.app).state.engine) as database:
        stored = database.get(Asset, UUID(asset_id))
    assert stored is not None and stored.deleted_at is not None


def test_asset_upload_rejects_mismatched_or_unsupported_content(
    asset_client: TestClient,
) -> None:
    alex = _login(asset_client, "alex@memora.local", "memora-local-alex")

    mismatched = asset_client.post(
        "/assets",
        headers=alex,
        json={
            "name": "not-a-png.png",
            "media_type": "image/png",
            "data": base64.b64encode(b"%PDF-1.4").decode(),
        },
    )
    assert mismatched.status_code == 422

    unsupported = asset_client.post(
        "/assets",
        headers=alex,
        json={
            "name": "notes.txt",
            "media_type": "text/plain",
            "data": base64.b64encode(b"hello").decode(),
        },
    )
    assert unsupported.status_code == 422
