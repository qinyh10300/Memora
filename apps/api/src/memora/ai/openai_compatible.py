from __future__ import annotations

import json
import math
from typing import Any, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from memora.ai.ports import AIProviderError, EmbeddingBatch, EmbeddingModelPort, ModelUsage
from memora.settings import Settings


class JSONTransport(Protocol):
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, object],
        timeout: float,
    ) -> dict[str, Any]: ...


class UrllibJSONTransport:
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, object],
        timeout: float,
    ) -> dict[str, Any]:
        request = Request(
            url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw_body = response.read()
        except HTTPError as error:
            if error.code == 429:
                raise AIProviderError("rate_limited", retryable=True) from error
            if error.code in {401, 403}:
                raise AIProviderError("authentication_failed", retryable=False) from error
            if error.code >= 500:
                raise AIProviderError("provider_unavailable", retryable=True) from error
            raise AIProviderError("invalid_provider_request", retryable=False) from error
        except TimeoutError as error:
            raise AIProviderError("provider_timeout", retryable=True) from error
        except URLError as error:
            raise AIProviderError("provider_unavailable", retryable=True) from error

        try:
            decoded = json.loads(raw_body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AIProviderError("invalid_provider_response", retryable=True) from error
        if not isinstance(decoded, dict):
            raise AIProviderError("invalid_provider_response", retryable=True)
        return cast(dict[str, Any], decoded)


class OpenAICompatibleEmbeddingModel(EmbeddingModelPort):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        transport: JSONTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibJSONTransport()

    @property
    def model_id(self) -> str:
        return self._model

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        if not texts or any(not text.strip() for text in texts):
            raise ValueError("embedding inputs must be non-empty")
        response = self._transport.post(
            f"{self._base_url}/embeddings",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            payload={"input": texts, "model": self._model, "encoding_format": "float"},
            timeout=self._timeout_seconds,
        )
        data = response.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise AIProviderError("invalid_provider_response", retryable=True)
        ordered = sorted(
            data, key=lambda item: item.get("index", -1) if isinstance(item, dict) else -1
        )
        vectors: list[list[float]] = []
        dimensions: int | None = None
        for item in ordered:
            if not isinstance(item, dict) or not isinstance(item.get("embedding"), list):
                raise AIProviderError("invalid_provider_response", retryable=True)
            vector = item["embedding"]
            if not vector or not all(
                isinstance(value, int | float) and math.isfinite(float(value)) for value in vector
            ):
                raise AIProviderError("invalid_provider_response", retryable=True)
            normalized = [float(value) for value in vector]
            if dimensions is None:
                dimensions = len(normalized)
            if len(normalized) != dimensions or len(normalized) > 16_000:
                raise AIProviderError("invalid_provider_response", retryable=True)
            vectors.append(normalized)

        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0
        response_model = response.get("model")
        return EmbeddingBatch(
            vectors=vectors,
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(input_tokens=input_tokens if isinstance(input_tokens, int) else 0),
        )


def build_embedding_model(settings: Settings) -> EmbeddingModelPort | None:
    api_key = settings.ai_embedding_api_key.get_secret_value()
    model = settings.ai_embedding_model.strip()
    if not api_key or not model:
        return None
    return OpenAICompatibleEmbeddingModel(
        base_url=settings.ai_embedding_base_url,
        api_key=api_key,
        model=model,
        timeout_seconds=settings.ai_request_timeout_seconds,
    )
