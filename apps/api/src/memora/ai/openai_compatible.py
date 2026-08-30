from __future__ import annotations

import base64
import binascii
import json
import math
import secrets
from collections.abc import Mapping
from time import perf_counter
from typing import Any, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import structlog

from memora.ai.image_registry import image_api_key
from memora.ai.ports import (
    AIProviderError,
    ChatMessage,
    ChatModelPort,
    ChatResult,
    ChatToolCall,
    ChatToolDefinition,
    ChatToolExecutor,
    EmbeddingBatch,
    EmbeddingModelPort,
    GeneratedImage,
    ImageGenerationPort,
    ImageGenerationRequest,
    ImageGenerationResult,
    ModelUsage,
    SpeechToTextPort,
    SpeechTranscriptionResult,
    WebSearchContextSize,
    WebSearchPort,
    WebSearchResult,
    WebSource,
)
from memora.observability import (
    ModelPricing,
    current_trace_headers,
    metrics,
    parse_model_pricing,
    record_ai_usage,
)
from memora.settings import Settings

logger = structlog.get_logger("memora.ai.provider")
MAX_GENERATED_IMAGE_BYTES = 8 * 1024 * 1024


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


class MultipartTransport(Protocol):
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        fields: dict[str, str],
        filename: str,
        media_type: str,
        content: bytes,
        timeout: float,
    ) -> dict[str, Any]: ...


class UrllibMultipartTransport:
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        fields: dict[str, str],
        filename: str,
        media_type: str,
        content: bytes,
        timeout: float,
    ) -> dict[str, Any]:
        boundary = f"memora-{secrets.token_hex(16)}"
        body = bytearray()
        for name, value in fields.items():
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            body.extend(value.encode())
            body.extend(b"\r\n")
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            (
                'Content-Disposition: form-data; name="file"; '
                f'filename="{filename}"\r\nContent-Type: {media_type}\r\n\r\n'
            ).encode()
        )
        body.extend(content)
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        request = Request(
            url,
            data=bytes(body),
            headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
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


def _observed_post(
    transport: JSONTransport,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, object],
    timeout: float,
    operation: str,
    model: str,
) -> dict[str, Any]:
    started_at = perf_counter()
    outcome = "success"
    try:
        return transport.post(
            url,
            headers={**headers, **current_trace_headers()},
            payload=payload,
            timeout=timeout,
        )
    except AIProviderError as error:
        outcome = error.code
        raise
    except Exception:
        outcome = "unexpected_error"
        raise
    finally:
        duration_seconds = max(0.0, perf_counter() - started_at)
        metrics.increment(
            "memora_ai_requests_total",
            labels={"operation": operation, "model": model, "outcome": outcome},
        )
        metrics.observe(
            "memora_ai_request_duration_seconds",
            labels={"operation": operation, "model": model},
            value=duration_seconds,
        )
        logger.info(
            "ai.provider_request_completed",
            operation=operation,
            model=model,
            outcome=outcome,
            duration_ms=round(duration_seconds * 1000, 2),
        )


class OpenAICompatibleEmbeddingModel(EmbeddingModelPort):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        transport: JSONTransport | None = None,
        pricing: Mapping[str, ModelPricing] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibJSONTransport()
        self._pricing = dict(pricing or {})

    @property
    def model_id(self) -> str:
        return self._model

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        if not texts or any(not text.strip() for text in texts):
            raise ValueError("embedding inputs must be non-empty")
        response = _observed_post(
            self._transport,
            f"{self._base_url}/embeddings",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            payload={"input": texts, "model": self._model, "encoding_format": "float"},
            timeout=self._timeout_seconds,
            operation="embedding",
            model=self._model,
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
        result = EmbeddingBatch(
            vectors=vectors,
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(input_tokens=input_tokens if isinstance(input_tokens, int) else 0),
        )
        record_ai_usage(
            operation="embedding",
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
            pricing=self._pricing,
        )
        return result


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
        pricing: Mapping[str, ModelPricing] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_output_tokens = max_output_tokens
        self._transport = transport or UrllibJSONTransport()
        self._pricing = dict(pricing or {})

    @property
    def model_id(self) -> str:
        return self._model

    def _provider_messages_for(self, messages: list[ChatMessage]) -> list[dict[str, object]]:
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
        return provider_messages

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        provider_messages = self._provider_messages_for(messages)
        response = _observed_post(
            self._transport,
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
            operation="chat",
            model=self._model,
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
        result = ChatResult(
            content=content.strip(),
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
        )
        record_ai_usage(
            operation="chat",
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
            pricing=self._pricing,
        )
        return result

    def complete_with_tools(
        self,
        messages: list[ChatMessage],
        tools: list[ChatToolDefinition],
        execute_tool: ChatToolExecutor,
    ) -> ChatResult:
        if not tools:
            return self.complete(messages)
        provider_messages = self._provider_messages_for(messages)
        provider_tools = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in tools
        ]
        total_usage = ModelUsage()
        response_model = self._model
        for _attempt in range(5):
            response = _observed_post(
                self._transport,
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                payload={
                    "model": self._model,
                    "messages": provider_messages,
                    "tools": provider_tools,
                    "tool_choice": "auto",
                    "max_tokens": self._max_output_tokens,
                    "stream": False,
                },
                timeout=self._timeout_seconds,
                operation="chat_tools",
                model=self._model,
            )
            usage = response.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0
            output_tokens = usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0
            total_usage = ModelUsage(
                input_tokens=total_usage.input_tokens
                + (input_tokens if isinstance(input_tokens, int) else 0),
                output_tokens=total_usage.output_tokens
                + (output_tokens if isinstance(output_tokens, int) else 0),
            )
            raw_response_model = response.get("model")
            if isinstance(raw_response_model, str):
                response_model = raw_response_model
            record_ai_usage(
                operation="chat_tools",
                model=response_model,
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
                pricing=self._pricing,
            )

            choices = response.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise AIProviderError("invalid_provider_response", retryable=True)
            message = choices[0].get("message")
            if not isinstance(message, dict):
                raise AIProviderError("invalid_provider_response", retryable=True)
            tool_calls = message.get("tool_calls")
            if not isinstance(tool_calls, list) or not tool_calls:
                content = message.get("content")
                if not isinstance(content, str) or not content.strip() or len(content) > 20_000:
                    raise AIProviderError("invalid_provider_response", retryable=True)
                return ChatResult(
                    content=content.strip(),
                    model=response_model,
                    usage=total_usage,
                )

            provider_messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content")
                    if isinstance(message.get("content"), str)
                    else "",
                    "tool_calls": tool_calls,
                }
            )
            for raw_call in tool_calls:
                if not isinstance(raw_call, dict):
                    raise AIProviderError("invalid_provider_response", retryable=True)
                call_id = raw_call.get("id")
                function = raw_call.get("function")
                if not isinstance(call_id, str) or not isinstance(function, dict):
                    raise AIProviderError("invalid_provider_response", retryable=True)
                name = function.get("name")
                raw_arguments = function.get("arguments")
                if not isinstance(name, str) or not isinstance(raw_arguments, str):
                    raise AIProviderError("invalid_provider_response", retryable=True)
                try:
                    decoded_arguments = json.loads(raw_arguments) if raw_arguments.strip() else {}
                except json.JSONDecodeError as error:
                    raise AIProviderError("invalid_provider_response", retryable=True) from error
                if not isinstance(decoded_arguments, dict):
                    raise AIProviderError("invalid_provider_response", retryable=True)
                result = execute_tool(
                    ChatToolCall(
                        id=call_id,
                        name=name,
                        arguments=cast(dict[str, object], decoded_arguments),
                    )
                )
                provider_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": result.content,
                    }
                )
        raise AIProviderError("tool_loop_exceeded", retryable=True)


def _generated_image_for(raw_data: object) -> GeneratedImage:
    if not isinstance(raw_data, str) or len(raw_data) > ((MAX_GENERATED_IMAGE_BYTES + 2) // 3) * 4:
        raise AIProviderError("invalid_provider_response", retryable=True)
    try:
        content = base64.b64decode(raw_data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise AIProviderError("invalid_provider_response", retryable=True) from error
    if len(content) > MAX_GENERATED_IMAGE_BYTES:
        raise AIProviderError("invalid_provider_response", retryable=True)
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
    elif content.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        media_type = "image/webp"
    else:
        raise AIProviderError("invalid_provider_response", retryable=True)
    return GeneratedImage(media_type=cast(Any, media_type), content=content)


def _image_size_for(aspect_ratio: str) -> str:
    return {
        "1:1": "1024x1024",
        "4:3": "1536x1024",
        "3:4": "1024x1536",
        "16:9": "1536x1024",
        "9:16": "1024x1536",
    }[aspect_ratio]


class OpenAICompatibleImageGenerator(ImageGenerationPort):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        transport: JSONTransport | None = None,
        pricing: Mapping[str, ModelPricing] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibJSONTransport()
        self._pricing = dict(pricing or {})

    @property
    def model_id(self) -> str:
        return self._model

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        prompt = request.prompt.strip()
        if not prompt or request.model_id != self._model or not 1 <= request.count <= 4:
            raise ValueError("image generation request is invalid")
        response = _observed_post(
            self._transport,
            f"{self._base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            payload={
                "model": self._model,
                "prompt": prompt,
                "n": request.count,
                "size": _image_size_for(request.aspect_ratio),
                "quality": request.quality,
                "response_format": "b64_json",
            },
            timeout=self._timeout_seconds,
            operation="image_generation",
            model=self._model,
        )
        data = response.get("data")
        if not isinstance(data, list) or len(data) != request.count:
            raise AIProviderError("invalid_provider_response", retryable=True)
        images: list[GeneratedImage] = []
        revised_prompts: list[str] = []
        for item in data:
            if not isinstance(item, dict):
                raise AIProviderError("invalid_provider_response", retryable=True)
            images.append(_generated_image_for(item.get("b64_json")))
            revised_prompt = item.get("revised_prompt")
            if isinstance(revised_prompt, str) and revised_prompt.strip():
                revised_prompts.append(revised_prompt.strip())
        usage = response.get("usage", {})
        input_tokens = usage.get("input_tokens", 0) if isinstance(usage, dict) else 0
        output_tokens = usage.get("output_tokens", 0) if isinstance(usage, dict) else 0
        response_model = response.get("model")
        result = ImageGenerationResult(
            images=tuple(images),
            revised_prompt="\n\n".join(revised_prompts) or None,
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
        )
        record_ai_usage(
            operation="image_generation",
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
            pricing=self._pricing,
        )
        return result


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
        pricing: Mapping[str, ModelPricing] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibJSONTransport()
        self._pricing = dict(pricing or {})

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
        response = _observed_post(
            self._transport,
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
            operation="web_search",
            model=self._model,
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
        result = WebSearchResult(
            content=content,
            sources=tuple(sources),
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
        )
        record_ai_usage(
            operation="web_search",
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
            pricing=self._pricing,
        )
        return result


class OpenAICompatibleSpeechToText(SpeechToTextPort):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        transport: MultipartTransport | None = None,
        pricing: Mapping[str, ModelPricing] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibMultipartTransport()
        self._pricing = dict(pricing or {})

    @property
    def model_id(self) -> str:
        return self._model

    def transcribe(
        self,
        audio: bytes,
        *,
        filename: str,
        media_type: str,
        language: str | None = None,
    ) -> SpeechTranscriptionResult:
        if not audio:
            raise ValueError("audio input must be non-empty")
        fields = {"model": self._model, "response_format": "json"}
        if language:
            fields["language"] = language
        started_at = perf_counter()
        outcome = "success"
        try:
            response = self._transport.post(
                f"{self._base_url}/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    **current_trace_headers(),
                },
                fields=fields,
                filename=filename,
                media_type=media_type,
                content=audio,
                timeout=self._timeout_seconds,
            )
        except AIProviderError as error:
            outcome = error.code
            raise
        except Exception:
            outcome = "unexpected_error"
            raise
        finally:
            duration_seconds = max(0.0, perf_counter() - started_at)
            metrics.increment(
                "memora_ai_requests_total",
                labels={
                    "operation": "speech_transcription",
                    "model": self._model,
                    "outcome": outcome,
                },
            )
            metrics.observe(
                "memora_ai_request_duration_seconds",
                labels={"operation": "speech_transcription", "model": self._model},
                value=duration_seconds,
            )
            logger.info(
                "ai.provider_request_completed",
                operation="speech_transcription",
                model=self._model,
                outcome=outcome,
                duration_ms=round(duration_seconds * 1000, 2),
            )

        text = response.get("text")
        if not isinstance(text, str) or not text.strip():
            raise AIProviderError("invalid_provider_response", retryable=True)
        usage = response.get("usage", {})
        input_tokens = usage.get("input_tokens", 0) if isinstance(usage, dict) else 0
        output_tokens = usage.get("output_tokens", 0) if isinstance(usage, dict) else 0
        response_model = response.get("model")
        result = SpeechTranscriptionResult(
            text=text.strip(),
            model=response_model if isinstance(response_model, str) else self._model,
            usage=ModelUsage(
                input_tokens=input_tokens if isinstance(input_tokens, int) else 0,
                output_tokens=output_tokens if isinstance(output_tokens, int) else 0,
            ),
        )
        record_ai_usage(
            operation="speech_transcription",
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
            pricing=self._pricing,
        )
        return result


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
        pricing=parse_model_pricing(settings.ai_model_pricing_json),
    )


def build_speech_to_text(settings: Settings) -> SpeechToTextPort | None:
    api_key = settings.ai_speech_api_key.get_secret_value()
    model = settings.ai_speech_model.strip()
    if not api_key or not model:
        return None
    return OpenAICompatibleSpeechToText(
        base_url=settings.ai_speech_base_url,
        api_key=api_key,
        model=model,
        timeout_seconds=settings.ai_speech_timeout_seconds,
        pricing=parse_model_pricing(settings.ai_model_pricing_json),
    )


def build_chat_model(
    settings: Settings,
    *,
    model: str | None = None,
    timeout_seconds: float | None = None,
) -> ChatModelPort | None:
    api_key = settings.ai_chat_api_key.get_secret_value()
    resolved_model = (model or settings.ai_chat_model).strip()
    if not api_key or not resolved_model:
        return None
    return OpenAICompatibleChatModel(
        base_url=settings.ai_chat_base_url,
        api_key=api_key,
        model=resolved_model,
        timeout_seconds=timeout_seconds or settings.ai_request_timeout_seconds,
        max_output_tokens=settings.ai_chat_max_output_tokens,
        pricing=parse_model_pricing(settings.ai_model_pricing_json),
    )


def build_web_search(settings: Settings, *, model: str | None = None) -> WebSearchPort | None:
    api_key = settings.ai_chat_api_key.get_secret_value()
    resolved_model = (settings.ai_web_search_model or model or settings.ai_chat_model).strip()
    if not settings.ai_web_search_enabled or not api_key or not resolved_model:
        return None
    return OpenAICompatibleWebSearch(
        base_url=settings.ai_chat_base_url,
        api_key=api_key,
        model=resolved_model,
        timeout_seconds=settings.ai_web_search_timeout_seconds,
        pricing=parse_model_pricing(settings.ai_model_pricing_json),
    )


def build_image_generator(
    settings: Settings,
    *,
    model: str,
) -> ImageGenerationPort | None:
    api_key = image_api_key(settings)
    if not settings.ai_visuals_enabled or not api_key or not model.strip():
        return None
    return OpenAICompatibleImageGenerator(
        base_url=settings.ai_image_base_url,
        api_key=api_key,
        model=model.strip(),
        timeout_seconds=settings.ai_image_request_timeout_seconds,
        pricing=parse_model_pricing(settings.ai_model_pricing_json),
    )
