from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: list[list[float]]
    model: str
    usage: ModelUsage


class EmbeddingModelPort(Protocol):
    @property
    def model_id(self) -> str: ...

    def embed(self, texts: list[str]) -> EmbeddingBatch: ...


@dataclass(frozen=True)
class ChatImageInput:
    media_type: Literal["image/png", "image/jpeg", "image/webp"]
    data: str
    detail: Literal["low", "high", "auto"] = "high"


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str
    images: tuple[ChatImageInput, ...] = ()


@dataclass(frozen=True)
class ChatResult:
    content: str
    model: str
    usage: ModelUsage


class ChatModelPort(Protocol):
    @property
    def model_id(self) -> str: ...

    def complete(self, messages: list[ChatMessage]) -> ChatResult: ...


WebSearchContextSize = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class WebSource:
    url: str
    title: str


@dataclass(frozen=True)
class WebSearchResult:
    content: str
    sources: tuple[WebSource, ...]
    model: str
    usage: ModelUsage


class WebSearchPort(Protocol):
    @property
    def model_id(self) -> str: ...

    def search(
        self,
        query: str,
        *,
        context_size: WebSearchContextSize,
    ) -> WebSearchResult: ...


class AIProviderError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable
