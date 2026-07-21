from typing import Any

import pytest
from pydantic import SecretStr

from memora.ai.openai_compatible import (
    OpenAICompatibleEmbeddingModel,
    build_embedding_model,
)
from memora.ai.ports import AIProviderError
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
