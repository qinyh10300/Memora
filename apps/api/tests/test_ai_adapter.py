from typing import Any

import pytest
from pydantic import SecretStr

from memora.ai.openai_compatible import (
    OpenAICompatibleChatModel,
    OpenAICompatibleEmbeddingModel,
    OpenAICompatibleWebSearch,
    build_chat_model,
    build_embedding_model,
    build_web_search,
)
from memora.ai.ports import AIProviderError, ChatImageInput, ChatMessage, ModelUsage
from memora.settings import Settings


class FakeTransport:
    def __init__(self, response: dict[str, Any]) -> None:
        self.response = response
        self.request: tuple[str, dict[str, str], dict[str, object], float] | None = None

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, object],
        timeout: float,
    ) -> dict[str, Any]:
        self.request = (url, headers, payload, timeout)
        return self.response


def test_embedding_adapter_uses_compatible_contract_and_orders_results() -> None:
    transport = FakeTransport(
        {
            "data": [
                {"index": 1, "embedding": [0.3, 0.4]},
                {"index": 0, "embedding": [0.1, 0.2]},
            ],
            "model": "embedding-model-v1",
            "usage": {"prompt_tokens": 9, "total_tokens": 9},
        }
    )
    model = OpenAICompatibleEmbeddingModel(
        base_url="https://relay.example/v1/",
        api_key="test-secret-key",
        model="embedding-model-v1",
        timeout_seconds=12,
        transport=transport,
    )

    result = model.embed(["第一条", "第二条"])

    assert result.vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert result.model == "embedding-model-v1"
    assert result.usage.input_tokens == 9
    assert transport.request is not None
    url, headers, payload, timeout = transport.request
    assert url == "https://relay.example/v1/embeddings"
    assert headers["Authorization"] == "Bearer test-secret-key"
    assert payload == {
        "input": ["第一条", "第二条"],
        "model": "embedding-model-v1",
        "encoding_format": "float",
    }
    assert timeout == 12


@pytest.mark.parametrize(
    "response",
    [
        {"data": []},
        {"data": [{"index": 0, "embedding": []}]},
        {"data": [{"index": 0, "embedding": [float("nan")]}]},
    ],
)
def test_embedding_adapter_rejects_malformed_provider_responses(
    response: dict[str, Any],
) -> None:
    model = OpenAICompatibleEmbeddingModel(
        base_url="https://relay.example/v1",
        api_key="test-secret-key",
        model="embedding-model-v1",
        timeout_seconds=12,
        transport=FakeTransport(response),
    )

    with pytest.raises(AIProviderError, match="invalid_provider_response") as captured:
        model.embed(["有效输入"])

    assert captured.value.retryable is True


def test_embedding_factory_requires_both_key_and_model_and_secrets_are_redacted() -> None:
    assert (
        build_embedding_model(
            Settings(ai_embedding_api_key=SecretStr(""), ai_embedding_model="model")
        )
        is None
    )
    assert (
        build_embedding_model(
            Settings(ai_embedding_api_key=SecretStr("key"), ai_embedding_model="")
        )
        is None
    )

    settings = Settings(
        ai_embedding_api_key=SecretStr("private-test-key"),
        ai_embedding_model="model",
    )
    model = build_embedding_model(settings)

    assert model is not None and model.model_id == "model"
    assert "private-test-key" not in repr(settings)


def test_chat_adapter_uses_compatible_contract_and_records_usage() -> None:
    transport = FakeTransport(
        {
            "choices": [{"message": {"role": "assistant", "content": "  有证据的回答  "}}],
            "model": "chat-model-v1",
            "usage": {"prompt_tokens": 21, "completion_tokens": 8},
        }
    )
    model = OpenAICompatibleChatModel(
        base_url="https://relay.example/v1/",
        api_key="test-secret-key",
        model="chat-model-v1",
        timeout_seconds=15,
        max_output_tokens=900,
        transport=transport,
    )

    result = model.complete([ChatMessage(role="user", content="请回答")])

    assert result.content == "有证据的回答"
    assert result.model == "chat-model-v1"
    assert result.usage.input_tokens == 21
    assert result.usage.output_tokens == 8
    assert transport.request is not None
    url, headers, payload, timeout = transport.request
    assert url == "https://relay.example/v1/chat/completions"
    assert headers["Authorization"] == "Bearer test-secret-key"
    assert payload == {
        "model": "chat-model-v1",
        "messages": [{"role": "user", "content": "请回答"}],
        "max_tokens": 900,
        "stream": False,
    }
    assert timeout == 15


def test_chat_adapter_translates_provider_independent_images() -> None:
    transport = FakeTransport(
        {
            "choices": [{"message": {"role": "assistant", "content": "图片内容是 Memora"}}],
            "model": "vision-model-v1",
            "usage": {"prompt_tokens": 45, "completion_tokens": 7},
        }
    )
    model = OpenAICompatibleChatModel(
        base_url="https://relay.example/v1",
        api_key="test-secret-key",
        model="vision-model-v1",
        timeout_seconds=15,
        max_output_tokens=900,
        transport=transport,
    )

    result = model.complete(
        [
            ChatMessage(
                role="user",
                content="读取这张图",
                images=(
                    ChatImageInput(
                        media_type="image/png",
                        data="dGVzdC1pbWFnZQ==",
                        detail="high",
                    ),
                ),
            )
        ]
    )

    assert result.content == "图片内容是 Memora"
    assert transport.request is not None
    payload = transport.request[2]
    assert payload["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "读取这张图"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,dGVzdC1pbWFnZQ==",
                        "detail": "high",
                    },
                },
            ],
        }
    ]


@pytest.mark.parametrize("response", [{}, {"choices": []}, {"choices": [{"message": {}}]}])
def test_chat_adapter_rejects_malformed_responses(response: dict[str, Any]) -> None:
    model = OpenAICompatibleChatModel(
        base_url="https://relay.example/v1",
        api_key="test-secret-key",
        model="chat-model-v1",
        timeout_seconds=15,
        max_output_tokens=900,
        transport=FakeTransport(response),
    )

    with pytest.raises(AIProviderError, match="invalid_provider_response"):
        model.complete([ChatMessage(role="user", content="请回答")])


def test_chat_factory_requires_key_and_model() -> None:
    assert build_chat_model(Settings(ai_chat_api_key=SecretStr(""), ai_chat_model="model")) is None
    assert build_chat_model(Settings(ai_chat_api_key=SecretStr("key"), ai_chat_model="")) is None
    model = build_chat_model(
        Settings(ai_chat_api_key=SecretStr("test-key"), ai_chat_model="chat-model")
    )
    assert model is not None and model.model_id == "chat-model"


def test_web_search_adapter_uses_responses_contract_and_collects_safe_sources() -> None:
    transport = FakeTransport(
        {
            "output": [
                {
                    "type": "web_search_call",
                    "action": {
                        "sources": [
                            {"url": "https://official.example/report", "title": "官方报告"},
                            {"url": "javascript:alert(1)", "title": "不安全链接"},
                        ]
                    },
                },
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "官方在 2026 年发布了报告。",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url": "https://official.example/report",
                                    "title": "官方报告",
                                },
                                {
                                    "type": "url_citation",
                                    "url": "https://research.example/analysis",
                                    "title": "研究分析",
                                },
                            ],
                        }
                    ],
                },
            ],
            "model": "search-model-v1",
            "usage": {"input_tokens": 120, "output_tokens": 18},
        }
    )
    model = OpenAICompatibleWebSearch(
        base_url="https://relay.example/v1/",
        api_key="test-secret-key",
        model="search-model-v1",
        timeout_seconds=90,
        transport=transport,
    )

    result = model.search("查询最新官方报告", context_size="medium")

    assert result.content == "官方在 2026 年发布了报告。"
    assert [source.url for source in result.sources] == [
        "https://official.example/report",
        "https://research.example/analysis",
    ]
    assert result.usage == ModelUsage(input_tokens=120, output_tokens=18)
    assert transport.request is not None
    url, headers, payload, timeout = transport.request
    assert url == "https://relay.example/v1/responses"
    assert headers["Authorization"] == "Bearer test-secret-key"
    assert payload == {
        "model": "search-model-v1",
        "tools": [
            {
                "type": "web_search",
                "search_context_size": "medium",
                "external_web_access": True,
            }
        ],
        "tool_choice": "required",
        "include": ["web_search_call.action.sources"],
        "input": "查询最新官方报告",
    }
    assert timeout == 90


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"output": []},
        {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "没有可验证来源"}],
                }
            ]
        },
    ],
)
def test_web_search_adapter_rejects_uncited_or_malformed_responses(
    response: dict[str, Any],
) -> None:
    model = OpenAICompatibleWebSearch(
        base_url="https://relay.example/v1",
        api_key="test-secret-key",
        model="search-model-v1",
        timeout_seconds=90,
        transport=FakeTransport(response),
    )

    with pytest.raises(AIProviderError, match="invalid_provider_response"):
        model.search("查询", context_size="low")


def test_web_search_factory_can_be_disabled_without_disabling_chat() -> None:
    settings = Settings(
        ai_chat_api_key=SecretStr("test-key"),
        ai_chat_model="chat-model",
        ai_web_search_enabled=False,
    )

    assert build_chat_model(settings) is not None
    assert build_web_search(settings) is None


def test_web_search_factory_prefers_dedicated_search_model() -> None:
    settings = Settings(
        ai_chat_api_key=SecretStr("test-key"),
        ai_chat_model="deep-chat-model",
        ai_web_search_model="fast-search-model",
    )

    search = build_web_search(settings, model="selected-chat-model")

    assert search is not None
    assert search.model_id == "fast-search-model"
