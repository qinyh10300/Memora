import json
from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.ai.ports import (
    ChatMessage,
    ChatResult,
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
    ModelUsage,
)
from memora.billing.models import CreditReservation
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings
from memora.visuals.models import VisualGenerationJob
from memora.visuals.worker import process_next_visual_job


@pytest.fixture
def visual_client() -> Iterator[tuple[TestClient, FastAPI]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="visual-test-secret-not-for-production",
        ai_chat_api_key=SecretStr("test-chat-key"),
        ai_model_registry_json=json.dumps(
            [
                {
                    "id": "structured",
                    "label": "Structured model",
                    "provider_model": "structured-provider",
                    "capabilities": ["chat", "tools"],
                    "default": True,
                },
                {
                    "id": "structured-ultra",
                    "label": "Structured Ultra",
                    "provider_model": "structured-ultra-provider",
                    "capabilities": ["chat", "tools"],
                    "min_plan": "ULTRA",
                },
            ]
        ),
        ai_image_api_key=SecretStr("test-image-key"),
        ai_image_model_registry_json=json.dumps(
            [{"id": "gpt-image-2", "provider_model": "image-provider"}]
        ),
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client, app


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def _create_project(
    client: TestClient,
    headers: dict[str, str],
    *,
    mode: str = "STRUCTURED",
    kind: str = "MIND_MAP",
    visibility: str = "PRIVATE",
) -> dict[str, object]:
    response = client.post(
        "/visuals",
        headers=headers,
        json={
            "title": "AI Native 研究图",
            "mode": mode,
            "kind": kind,
            "visibility": visibility,
        },
    )
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def test_visual_catalog_exposes_requested_engines_and_plan_locks(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, _app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")

    models = client.get("/visuals/models", headers=alex).json()

    assert [model["label"] for model in models] == [
        "GPT Image 2",
        "Nano Banana",
        "Nano Banana 2",
        "Nano Banana Pro",
    ]
    assert models[0]["configured"] is True
    assert models[0]["locked"] is False
    assert models[2]["locked"] is True
    templates = client.get("/visuals/templates", headers=alex).json()
    assert [template["id"] for template in templates] == [
        "scientific-illustration",
        "mind-map",
        "flowchart",
        "timeline",
    ]


def test_queue_and_cancel_visual_job_reserves_then_releases_credits(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    project = _create_project(client, alex)
    memory = client.post(
        "/memories",
        headers=alex,
        json={"title": "研究问题", "body": "梳理数据、假设和验证路径。"},
    ).json()

    queued = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "生成一张研究路径思维导图",
            "model_id": "structured",
            "memory_ids": [memory["id"]],
        },
    )

    assert queued.status_code == 200
    job = queued.json()["job"]
    assert job["status"] == "QUEUED"
    assert queued.json()["credits_reserved"] == 30
    subscription = client.get("/billing/subscription", headers=alex).json()
    assert subscription["credits_reserved"] == 30
    status_response = client.get(f"/visual-jobs/{job['id']}", headers=alex)
    assert status_response.status_code == 200

    cancelled = client.post(f"/visual-jobs/{job['id']}/cancel", headers=alex)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    subscription = client.get("/billing/subscription", headers=alex).json()
    assert subscription["credits_reserved"] == 0
    assert subscription["credits_used"] == 0
    with Session(app.state.engine) as database:
        persisted_job = database.scalar(select(VisualGenerationJob))
        reservation = database.scalar(select(CreditReservation))
        assert persisted_job is not None and persisted_job.status == "CANCELLED"
        assert reservation is not None and reservation.status == "RELEASED"


def test_shared_visual_cannot_reference_private_memory(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, _app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    project = _create_project(client, alex, visibility="WORKSPACE")
    memory = client.post(
        "/memories",
        headers=alex,
        json={"title": "私有研究", "body": "PRIVATE_VISUAL_SOURCE"},
    ).json()

    response = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "生成共享思维导图",
            "model_id": "structured",
            "memory_ids": [memory["id"]],
        },
    )

    assert response.status_code == 403
    assert "共享作品" in response.json()["detail"]


def test_structured_visual_rejects_model_above_current_plan(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, _app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    project = _create_project(client, alex)

    response = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "生成研究路径图",
            "model_id": "structured-ultra",
            "memory_ids": [],
        },
    )

    assert response.status_code == 403
    assert "Ultra 套餐" in response.json()["detail"]


class StructuredVisualModel:
    model_id = "structured-provider"

    def __init__(self, memory_id: str) -> None:
        self.memory_id = memory_id
        self.messages: list[ChatMessage] = []

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        self.messages = messages
        return ChatResult(
            content=json.dumps(
                {
                    "title": "研究路径",
                    "nodes": [
                        {
                            "id": "source",
                            "kind": "MEMORY",
                            "memory_id": self.memory_id,
                            "position": {"x": 0, "y": 0},
                        },
                        {
                            "id": "conclusion",
                            "kind": "NOTE",
                            "text": "验证关键假设",
                            "position": {"x": 280, "y": 0},
                        },
                    ],
                    "edges": [
                        {
                            "id": "edge-1",
                            "source": "source",
                            "target": "conclusion",
                            "label": "支持",
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            model=self.model_id,
            usage=ModelUsage(input_tokens=30, output_tokens=20),
        )


class ImageVisualModel:
    model_id = "image-provider"

    def __init__(self) -> None:
        self.requests: list[ImageGenerationRequest] = []

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        self.requests.append(request)
        png = (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        )
        return ImageGenerationResult(
            images=(
                GeneratedImage(media_type="image/png", content=png),
                GeneratedImage(media_type="image/png", content=png),
            ),
            revised_prompt="publication-ready scientific illustration",
            model=self.model_id,
            usage=ModelUsage(input_tokens=18, output_tokens=4),
        )


def test_structured_worker_creates_candidate_then_confirmation_creates_diagram(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    project = _create_project(client, alex)
    memory = client.post(
        "/memories",
        headers=alex,
        json={"title": "研究路径", "body": "先收集数据，再验证关键假设。"},
    ).json()
    queued = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "整理研究路径",
            "model_id": "structured",
            "memory_ids": [memory["id"]],
        },
    )
    assert queued.status_code == 200

    model = StructuredVisualModel(memory["id"])
    assert process_next_visual_job(app.state.engine, app.state.settings, chat_model=model)

    generated = client.get(f"/visuals/{project['id']}", headers=alex).json()
    assert generated["status"] == "WAITING_CONFIRMATION"
    assert generated["latest_job"]["status"] == "WAITING_CONFIRMATION"
    assert generated["versions"][0]["graph"]["nodes"][0]["memory_id"] == memory["id"]
    subscription = client.get("/billing/subscription", headers=alex).json()
    assert subscription["credits_reserved"] == 0
    assert subscription["credits_used"] == 30
    version_id = generated["versions"][0]["id"]

    confirmed = client.post(
        f"/visuals/{project['id']}/confirm-structure",
        headers=alex,
        json={"version_id": version_id},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "COMPLETED"
    assert confirmed.json()["versions"][0]["diagram_id"] is not None
    diagrams = client.get("/diagrams", headers=alex).json()
    assert any(diagram["title"] == "研究路径" for diagram in diagrams)
    prompt = "\n".join(message.content for message in model.messages)
    assert "先收集数据" in prompt


def test_image_worker_honors_generation_settings_and_saves_all_candidates(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    project = _create_project(client, alex, mode="IMAGE", kind="SCIENTIFIC")
    queued = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "绘制细胞信号通路",
            "model_id": "gpt-image-2",
            "aspect_ratio": "16:9",
            "count": 2,
            "quality": "high",
            "scientific_style": True,
            "watermark_mode": "CLEAN_OUTPUT",
            "output_language": "中文",
        },
    )
    assert queued.status_code == 200
    assert queued.json()["credits_reserved"] == 240

    model = ImageVisualModel()
    assert process_next_visual_job(
        app.state.engine,
        app.state.settings,
        image_generator=model,
    )

    completed = client.get(f"/visuals/{project['id']}", headers=alex).json()
    assert completed["status"] == "COMPLETED"
    assert len(completed["versions"]) == 2
    assert all(version["asset_url"] for version in completed["versions"])
    assert model.requests[0].aspect_ratio == "16:9"
    assert model.requests[0].count == 2
    assert "Do not add a watermark" in model.requests[0].prompt
    assert "Use 中文" in model.requests[0].prompt
    asset_path = completed["versions"][0]["asset_url"].removeprefix("/api")
    content = client.get(asset_path, headers=alex)
    assert content.status_code == 200
    assert content.headers["content-type"] == "image/png"
    subscription = client.get("/billing/subscription", headers=alex).json()
    assert subscription["credits_reserved"] == 0
    assert subscription["credits_used"] == 240


def test_unshared_source_hides_shared_visual_project_job_and_asset(
    visual_client: tuple[TestClient, FastAPI],
) -> None:
    client, app = visual_client
    alex = _login(client, "alex@memora.local", "memora-local-alex")
    blair = _login(client, "blair@memora.local", "memora-local-blair")
    project = _create_project(
        client,
        alex,
        mode="IMAGE",
        kind="SCIENTIFIC",
        visibility="WORKSPACE",
    )
    memory = client.post(
        "/memories",
        headers=alex,
        json={"title": "共享科研来源", "body": "只在主动共享期间可用于团队科研图片。"},
    ).json()
    assert client.post(f"/memories/{memory['id']}/share", headers=alex).status_code == 200
    queued = client.post(
        f"/visuals/{project['id']}/generate",
        headers=alex,
        json={
            "prompt": "生成共享科研图片",
            "model_id": "gpt-image-2",
            "memory_ids": [memory["id"]],
            "count": 2,
        },
    )
    assert queued.status_code == 200
    job_id = queued.json()["job"]["id"]
    model = ImageVisualModel()
    assert process_next_visual_job(
        app.state.engine,
        app.state.settings,
        image_generator=model,
    )

    visible = client.get(f"/visuals/{project['id']}", headers=blair)
    assert visible.status_code == 200
    asset_path = visible.json()["versions"][0]["asset_url"].removeprefix("/api")
    assert client.get(asset_path, headers=blair).status_code == 200

    assert client.post(f"/memories/{memory['id']}/unshare", headers=alex).status_code == 200
    assert client.get(f"/visuals/{project['id']}", headers=blair).status_code == 404
    assert client.get(f"/visual-jobs/{job_id}", headers=blair).status_code == 404
    assert client.get(asset_path, headers=blair).status_code == 404
    listed_ids = {item["id"] for item in client.get("/visuals", headers=blair).json()}
    assert project["id"] not in listed_ids
    assert client.get(f"/visuals/{project['id']}", headers=alex).status_code == 200
