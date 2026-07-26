from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.ai.ports import AIProviderError, ChatMessage, ChatResult, ModelUsage
from memora.audit.models import AuditEvent
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.memories.models import Memory
from memora.settings import Settings


@pytest.fixture
def draft_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="draft-test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client


def _login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"email": "alex@memora.local", "password": "memora-local-alex"},
    )
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


class CaptureDraftModel:
    model_id = "draft-model"

    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        self.messages = messages
        return ChatResult(
            content="```markdown\n# 商业模式\n\n先验证按席位订阅。\n```",
            model=self.model_id,
            usage=ModelUsage(input_tokens=32, output_tokens=12),
        )


class FailingDraftModel:
    model_id = "failing-model"

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        raise AIProviderError("provider_timeout", retryable=True)


def test_refine_draft_updates_markdown_without_creating_memory_and_records_usage(
    draft_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _login(draft_client)
    model = CaptureDraftModel()
    monkeypatch.setattr("memora.api.drafts.build_chat_model", lambda _settings: model)

    response = draft_client.post(
        "/drafts/refine",
        headers=headers,
        json={
            "markdown": "# 商业模式\n\n先探索项目制。",
            "instruction": "改成按席位订阅，并保持简洁。",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "markdown": "# 商业模式\n\n先验证按席位订阅。",
        "assistant_message": "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
        "model_status": "AVAILABLE",
    }
    assert "CURRENT_MARKDOWN" in model.messages[1].content
    assert "USER_INSTRUCTION" in model.messages[1].content

    engine = cast(FastAPI, draft_client.app).state.engine
    with Session(engine) as database:
        memories = database.scalars(select(Memory)).all()
        event = database.scalar(select(AuditEvent).where(AuditEvent.action == "DRAFT_REFINED"))
    assert memories == []
    assert event is not None
    assert event.model == "draft-model"
    assert event.input_tokens == 32
    assert event.output_tokens == 12
    assert not hasattr(event, "body")


def test_refine_draft_has_safe_disabled_and_degraded_fallbacks(
    draft_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _login(draft_client)

    initial = draft_client.post(
        "/drafts/refine",
        headers=headers,
        json={"markdown": "", "instruction": "记录我想先验证个人记忆。"},
    )
    assert initial.status_code == 200
    assert initial.json()["markdown"] == "# 新想法\n\n记录我想先验证个人记忆。"
    assert initial.json()["model_status"] == "DISABLED"
    assert "还没有保存" in initial.json()["assistant_message"]

    existing = "# 当前草稿\n\n不能丢失"
    unchanged = draft_client.post(
        "/drafts/refine",
        headers=headers,
        json={"markdown": existing, "instruction": "帮我改得更清晰"},
    )
    assert unchanged.status_code == 200
    assert unchanged.json()["markdown"] == existing
    assert unchanged.json()["model_status"] == "DISABLED"

    monkeypatch.setattr("memora.api.drafts.build_chat_model", lambda _settings: FailingDraftModel())
    degraded = draft_client.post(
        "/drafts/refine",
        headers=headers,
        json={"markdown": existing, "instruction": "再试一次"},
    )
    assert degraded.status_code == 200
    assert degraded.json() == {
        "markdown": existing,
        "assistant_message": "这次没有成功调用 AI，草稿保持不变。",
        "model_status": "DEGRADED",
    }


def test_refine_draft_requires_auth_and_rejects_blank_instruction(
    draft_client: TestClient,
) -> None:
    assert (
        draft_client.post(
            "/drafts/refine",
            json={"markdown": "", "instruction": "匿名内容"},
        ).status_code
        == 401
    )
    headers = _login(draft_client)
    assert (
        draft_client.post(
            "/drafts/refine",
            headers=headers,
            json={"markdown": "", "instruction": "   "},
        ).status_code
        == 422
    )
