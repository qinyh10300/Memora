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
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class ChatResult:
    content: str
    model: str
    usage: ModelUsage


class ChatModelPort(Protocol):
    @property
    def model_id(self) -> str: ...

    def complete(self, messages: list[ChatMessage]) -> ChatResult: ...


class AIProviderError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable
