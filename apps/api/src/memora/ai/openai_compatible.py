from __future__ import annotations

import json
import math
from typing import Any, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from memora.ai.ports import (
    AIProviderError,
    ChatMessage,
    ChatModelPort,
    ChatResult,
    EmbeddingBatch,
    EmbeddingModelPort,
    ModelUsage,
    WebSearchContextSize,
    WebSearchPort,
    WebSearchResult,
    WebSource,
)
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


class OpenAICompatibleChatModel(ChatModelPort):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        max_output_tokens: int,
        transport: JSONTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_output_tokens = max_output_tokens
        self._transport = transport or UrllibJSONTransport()

    @property
    def model_id(self) -> str:
        return self._model

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        if not messages or any(
            not message.content.strip() and not message.images for message in messages
        ):
            raise ValueError("chat messages must be non-empty")
        provider_messages: list[dict[str, object]] = []
        for message in messages:
            if not message.images:
                provider_messages.append({"role": message.role, "content": message.content})
                continue
            content_parts: list[dict[str, object]] = []
            if message.content.strip():
                content_parts.append({"type": "text", "text": message.content})
            content_parts.extend(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image.media_type};base64,{image.data}",
                        "detail": image.detail,
                    },
                }
                for image in message.images
            )
            provider_messages.append({"role": message.role, "content": content_parts})
        response = self._transport.post(
            f"{self._base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            payload={
                "model": self._model,
                "messages": provider_messages,
                "max_tokens": self._max_output_tokens,
                "stream": False,
            },
            timeout=self._timeout_seconds,
        )
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise AIProviderError("invalid_provider_response", retryable=True)
        response_message = choices[0].get("message")
        content = response_message.get("content") if isinstance(response_message, dict) else None
        if not isinstance(content, str) or not content.strip() or len(content) > 20_000:
            raise AIProviderError("invalid_provider_response", retryable=True)
        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0
        output_tokens = usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0
        response_model = response.get("model")
        return ChatResult(
            content=content.strip(),
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
        )


def _valid_http_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 2_048:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return value


class OpenAICompatibleWebSearch(WebSearchPort):
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

    def search(
        self,
        query: str,
        *,
        context_size: WebSearchContextSize,
    ) -> WebSearchResult:
        normalized_query = query.strip()
        if not normalized_query:
            raise ValueError("web search query must be non-empty")
        response = self._transport.post(
            f"{self._base_url}/responses",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            payload={
                "model": self._model,
                "tools": [
                    {
                        "type": "web_search",
                        "search_context_size": context_size,
                        "external_web_access": True,
                    }
                ],
                "tool_choice": "required",
                "include": ["web_search_call.action.sources"],
                "input": normalized_query,
            },
            timeout=self._timeout_seconds,
        )
        output = response.get("output")
        if not isinstance(output, list):
            raise AIProviderError("invalid_provider_response", retryable=True)

        text_parts: list[str] = []
        source_candidates: list[tuple[object, object]] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                content = item.get("content")
                if not isinstance(content, list):
                    continue
                for content_item in content:
                    if (
                        not isinstance(content_item, dict)
                        or content_item.get("type") != "output_text"
                    ):
                        continue
                    text = content_item.get("text")
                    if isinstance(text, str) and text.strip():
                        text_parts.append(text.strip())
                    annotations = content_item.get("annotations")
                    if isinstance(annotations, list):
                        for annotation in annotations:
                            if (
                                isinstance(annotation, dict)
                                and annotation.get("type") == "url_citation"
                            ):
                                source_candidates.append(
                                    (annotation.get("url"), annotation.get("title"))
                                )
            if item.get("type") == "web_search_call":
                action = item.get("action")
                action_sources = action.get("sources") if isinstance(action, dict) else None
                if isinstance(action_sources, list):
                    for source in action_sources:
                        if isinstance(source, dict):
                            source_candidates.append((source.get("url"), source.get("title")))

        content = "\n\n".join(text_parts).strip()
        if not content or len(content) > 20_000:
            raise AIProviderError("invalid_provider_response", retryable=True)

        sources: list[WebSource] = []
        seen_urls: set[str] = set()
        for raw_url, raw_title in source_candidates:
            url = _valid_http_url(raw_url)
            if url is None or url in seen_urls:
                continue
            title = raw_title.strip() if isinstance(raw_title, str) else ""
            sources.append(WebSource(url=url, title=title[:300] or urlparse(url).netloc))
            seen_urls.add(url)
            if len(sources) >= 8:
                break
        if not sources:
            raise AIProviderError("invalid_provider_response", retryable=True)

        usage = response.get("usage", {})
        input_tokens = usage.get("input_tokens", 0) if isinstance(usage, dict) else 0
        output_tokens = usage.get("output_tokens", 0) if isinstance(usage, dict) else 0
        response_model = response.get("model")
        return WebSearchResult(
            content=content,
            sources=tuple(sources),
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
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


def build_chat_model(settings: Settings) -> ChatModelPort | None:
    api_key = settings.ai_chat_api_key.get_secret_value()
    model = settings.ai_chat_model.strip()
    if not api_key or not model:
        return None
    return OpenAICompatibleChatModel(
        base_url=settings.ai_chat_base_url,
        api_key=api_key,
        model=model,
        timeout_seconds=settings.ai_request_timeout_seconds,
        max_output_tokens=settings.ai_chat_max_output_tokens,
    )


def build_web_search(settings: Settings) -> WebSearchPort | None:
    api_key = settings.ai_chat_api_key.get_secret_value()
    model = settings.ai_chat_model.strip()
    if not settings.ai_web_search_enabled or not api_key or not model:
        return None
    return OpenAICompatibleWebSearch(
        base_url=settings.ai_chat_base_url,
        api_key=api_key,
        model=model,
        timeout_seconds=settings.ai_web_search_timeout_seconds,
    )
