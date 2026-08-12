from collections.abc import Iterator
from typing import cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.ai.ports import ChatMessage, ChatResult, ModelUsage
from memora.conversations.models import Conversation, Message, MessageCitation
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.memories.models import Memory
from memora.settings import Settings


@pytest.fixture
def chat_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="chat-test-secret-not-for-production",
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


def _create(client: TestClient, headers: dict[str, str], body: str) -> dict[str, object]:
    response = client.post("/memories", headers=headers, json={"body": body})
    assert response.status_code == 201
    return cast(dict[str, object], response.json())


def _ask(
    client: TestClient,
    headers: dict[str, str],
    *,
    question: str = "我之前对商业模式的看法是什么？",
    topic: str | None = "商业模式",
    scope: str = "PERSONAL",
    author_id: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {"question": question, "topic": topic, "scope": scope}
    if author_id is not None:
        payload["author_id"] = author_id
    response = client.post("/chat/questions", headers=headers, json=payload)
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_personal_chat_uses_private_evidence_and_persists_auditable_citation(
    chat_client: TestClient,
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")
    created = _create(chat_client, alex, "商业模式先按席位订阅，再验证团队报告价值。")

    answer = _ask(chat_client, alex)

    assert answer["status"] == "ANSWERED"
    assert answer["model_status"] == "DISABLED"
    citations = cast(list[dict[str, object]], answer["citations"])
    assert [item["memory_id"] for item in citations] == [created["id"]]
    assert citations[0]["author"] == {
        "id": cast(dict[str, object], created["author"])["id"],
        "display_name": "Alex",
    }
    assert citations[0]["created_at"]
    assert citations[0]["href"] == f"/#memory-{created['id']}"
    assert "我不知道" not in cast(str, answer["answer"])

    engine = cast(FastAPI, chat_client.app).state.engine
    with Session(engine) as database:
        conversation = database.get(Conversation, UUID(cast(str, answer["conversation_id"])))
        message = database.get(Message, UUID(cast(str, answer["message_id"])))
        assert message is not None
        stored_citations = database.scalars(
            select(MessageCitation).where(MessageCitation.message_id == message.id)
        ).all()
    assert conversation is not None and conversation.scope == "PERSONAL"
    assert message is not None and message.role == "ASSISTANT" and message.model is None
    assert len(stored_citations) == 1


def test_colleague_chat_only_sees_shared_records_and_unshare_invalidates_old_answer(
    chat_client: TestClient,
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")
    blair = _login(chat_client, "blair@memora.local", "memora-local-blair")
    created = _create(chat_client, alex, "商业模式需要先观察四人团队的持续记录率。")
    alex_id = cast(str, cast(dict[str, object], created["author"])["id"])

    private_answer = _ask(chat_client, blair, scope="COLLEAGUE", author_id=alex_id)
    assert private_answer["status"] == "NO_EVIDENCE"
    assert private_answer["citations"] == []
    assert "我不知道" in cast(str, private_answer["answer"])

    assert chat_client.post(f"/memories/{created['id']}/share", headers=alex).status_code == 200
    shared_answer = _ask(chat_client, blair, scope="COLLEAGUE", author_id=alex_id)
    assert shared_answer["status"] == "ANSWERED"
    shared_citations = cast(list[dict[str, object]], shared_answer["citations"])
    assert [item["memory_id"] for item in shared_citations] == [created["id"]]

    assert chat_client.post(f"/memories/{created['id']}/unshare", headers=alex).status_code == 200
    engine = cast(FastAPI, chat_client.app).state.engine
    message_id = UUID(cast(str, shared_answer["message_id"]))
    with Session(engine) as database:
        message = database.get(Message, message_id)
        citations = database.scalars(
            select(MessageCitation).where(MessageCitation.message_id == message_id)
        ).all()
    assert message is not None and message.status == "REDACTED"
    assert "来源已被撤回" in message.content
    assert citations == []


class CaptureChatModel:
    model_id = "capture-chat"

    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        self.messages = messages
        return ChatResult(
            content="只基于授权证据生成的回答。",
            model=self.model_id,
            usage=ModelUsage(input_tokens=30, output_tokens=9),
        )


def test_external_model_receives_only_authorized_minimal_evidence(
    chat_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")
    blair = _login(chat_client, "blair@memora.local", "memora-local-blair")
    private = _create(chat_client, alex, "边界验证：PRIVATE_SECRET_NEVER_SEND")
    shared = _create(chat_client, alex, "边界验证：这是可以发送的共享证据。")
    assert chat_client.post(f"/memories/{shared['id']}/share", headers=alex).status_code == 200
    model = CaptureChatModel()
    monkeypatch.setattr("memora.api.chat.build_chat_model", lambda _settings: model)

    answer = _ask(
        chat_client,
        blair,
        question="团队在边界验证上记录了什么？",
        topic="边界验证",
        scope="WORKSPACE",
    )

    prompt = "\n".join(message.content for message in model.messages)
    assert "这是可以发送的共享证据" in prompt
    assert "PRIVATE_SECRET_NEVER_SEND" not in prompt
    assert str(private["id"]) not in prompt
    assert answer["answer"] == "只基于授权证据生成的回答。"
    assert answer["model_status"] == "AVAILABLE"
    answer_citations = cast(list[dict[str, object]], answer["citations"])
    assert [item["memory_id"] for item in answer_citations] == [shared["id"]]


def test_workspace_chat_reauthorizes_scope_after_owner_unshares_during_model(
    chat_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")
    shared = _create(chat_client, alex, "范围重授权验证：生成完成前撤回共享。")
    assert chat_client.post(f"/memories/{shared['id']}/share", headers=alex).status_code == 200
    engine = cast(FastAPI, chat_client.app).state.engine
    model = CaptureChatModel()
    complete = model.complete

    def complete_and_unshare(messages: list[ChatMessage]) -> ChatResult:
        result = complete(messages)
        with Session(engine) as database:
            stored = database.get(Memory, UUID(cast(str, shared["id"])))
            assert stored is not None
            stored.visibility = "PRIVATE"
            stored.shared_at = None
            database.commit()
        return result

    monkeypatch.setattr(model, "complete", complete_and_unshare)
    monkeypatch.setattr("memora.api.chat.build_chat_model", lambda _settings: model)

    answer = _ask(
        chat_client,
        alex,
        question="团队在范围重授权验证上记录了什么？",
        topic="范围重授权验证",
        scope="WORKSPACE",
    )

    assert answer["status"] == "NO_EVIDENCE"
    assert answer["model_status"] == "DEGRADED"
    assert answer["citations"] == []
    assert "我不知道" in cast(str, answer["answer"])


def test_chat_deleted_during_model_returns_not_found(
    chat_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")
    _create(chat_client, alex, "并发删除验证：只用这条授权记录回答。")
    conversation = chat_client.post(
        "/conversations",
        headers=alex,
        json={"title": "问答并发删除验证"},
    ).json()
    engine = cast(FastAPI, chat_client.app).state.engine
    model = CaptureChatModel()
    complete = model.complete

    def complete_and_delete(messages: list[ChatMessage]) -> ChatResult:
        result = complete(messages)
        with Session(engine) as database:
            stored = database.get(Conversation, UUID(conversation["id"]))
            assert stored is not None
            database.delete(stored)
            database.commit()
        return result

    monkeypatch.setattr(model, "complete", complete_and_delete)
    monkeypatch.setattr("memora.api.chat.build_chat_model", lambda _settings: model)

    response = chat_client.post(
        "/chat/questions",
        headers=alex,
        json={
            "conversation_id": conversation["id"],
            "question": "并发删除验证记录了什么？",
            "topic": "并发删除验证",
            "scope": "PERSONAL",
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "对话不存在"}


def test_ambiguous_period_requires_dates_and_invalid_scope_is_rejected(
    chat_client: TestClient,
) -> None:
    alex = _login(chat_client, "alex@memora.local", "memora-local-alex")

    clarification = _ask(
        chat_client,
        alex,
        question="总结我这段时间关于商业模式的想法。",
    )
    assert clarification["status"] == "NEEDS_CLARIFICATION"
    assert clarification["conversation_id"] is not None
    assert clarification["message_id"] is not None
    assert "开始和结束日期" in cast(str, clarification["answer"])

    missing_topic = _ask(chat_client, alex, question="我以前怎么想的？", topic=None)
    assert missing_topic["status"] == "NEEDS_CLARIFICATION"
    assert "检索主题" in cast(str, missing_topic["answer"])

    invalid = chat_client.post(
        "/chat/questions",
        headers=alex,
        json={
            "question": "查看同事想法",
            "topic": "商业模式",
            "scope": "COLLEAGUE",
        },
    )
    assert invalid.status_code == 422
