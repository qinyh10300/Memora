from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic
from typing import Literal

from pydantic import BaseModel, ValidationError

from memora.ai.ports import ChatToolCall, ChatToolDefinition, ChatToolResult
from memora.observability import metrics

AgentToolStatus = Literal["COMPLETED", "REJECTED", "FAILED", "DEGRADED"]


@dataclass(frozen=True)
class AgentToolPolicyDecision:
    allowed: bool
    code: str = "allowed"

    @classmethod
    def allow(cls) -> AgentToolPolicyDecision:
        return cls(allowed=True)

    @classmethod
    def deny(cls, code: str) -> AgentToolPolicyDecision:
        return cls(allowed=False, code=code)


@dataclass(frozen=True)
class AgentToolInvocation:
    call_id: str
    attempt: int
    timeout_seconds: float


@dataclass(frozen=True)
class AgentToolHandlerResult:
    result: ChatToolResult
    status: AgentToolStatus
    code: str
    item_count: int | None = None


@dataclass(frozen=True)
class AgentToolExecutionResult:
    name: str
    result: ChatToolResult
    status: AgentToolStatus
    code: str
    attempts: int
    duration_ms: int
    item_count: int | None = None


class AgentToolFailure(RuntimeError):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


AgentToolHandler = Callable[[BaseModel, AgentToolInvocation], AgentToolHandlerResult]
AgentToolPolicy = Callable[[BaseModel], AgentToolPolicyDecision]


@dataclass(frozen=True)
class RegisteredAgentTool:
    definition: ChatToolDefinition
    arguments_model: type[BaseModel]
    handler: AgentToolHandler
    policy: AgentToolPolicy
    timeout_seconds: float
    max_attempts: int
    max_calls: int
    exposed: bool


def _safe_result(status: AgentToolStatus, code: str) -> ChatToolResult:
    return ChatToolResult(
        content=json.dumps(
            {"status": status.casefold(), "reason": code},
            ensure_ascii=False,
        )
    )


class AgentToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, RegisteredAgentTool] = {}
        self._call_counts: dict[str, int] = {}

    def register(
        self,
        *,
        definition: ChatToolDefinition,
        arguments_model: type[BaseModel],
        handler: AgentToolHandler,
        policy: AgentToolPolicy,
        timeout_seconds: float,
        max_attempts: int = 1,
        max_calls: int = 1,
        exposed: bool = True,
    ) -> None:
        if definition.name in self._tools:
            raise ValueError(f"agent tool already registered: {definition.name}")
        if timeout_seconds <= 0:
            raise ValueError("agent tool timeout must be positive")
        if max_attempts < 1 or max_calls < 1:
            raise ValueError("agent tool attempt and call limits must be positive")
        self._tools[definition.name] = RegisteredAgentTool(
            definition=definition,
            arguments_model=arguments_model,
            handler=handler,
            policy=policy,
            timeout_seconds=timeout_seconds,
            max_attempts=max_attempts,
            max_calls=max_calls,
            exposed=exposed,
        )

    def definitions(self) -> list[ChatToolDefinition]:
        return [tool.definition for tool in self._tools.values() if tool.exposed]

    def execute(self, call: ChatToolCall) -> AgentToolExecutionResult:
        started_at = monotonic()
        tool = self._tools.get(call.name)
        if tool is None:
            return self._rejected(
                name="unknown",
                code="unknown_tool",
                started_at=started_at,
            )

        call_count = self._call_counts.get(call.name, 0) + 1
        self._call_counts[call.name] = call_count
        if call_count > tool.max_calls:
            return self._rejected(
                name=call.name,
                code="tool_call_limit_exceeded",
                started_at=started_at,
            )

        try:
            arguments = tool.arguments_model.model_validate(call.arguments)
        except ValidationError:
            return self._rejected(
                name=call.name,
                code="invalid_tool_arguments",
                started_at=started_at,
            )

        decision = tool.policy(arguments)
        if not decision.allowed:
            return self._rejected(
                name=call.name,
                code=decision.code,
                started_at=started_at,
            )

        for attempt in range(1, tool.max_attempts + 1):
            invocation = AgentToolInvocation(
                call_id=call.id,
                attempt=attempt,
                timeout_seconds=tool.timeout_seconds,
            )
            try:
                handled = tool.handler(arguments, invocation)
            except AgentToolFailure as error:
                if error.retryable and attempt < tool.max_attempts:
                    continue
                status: AgentToolStatus = "DEGRADED" if error.retryable else "FAILED"
                return self._observed(
                    AgentToolExecutionResult(
                        name=call.name,
                        result=_safe_result(status, error.code),
                        status=status,
                        code=error.code,
                        attempts=attempt,
                        duration_ms=self._elapsed_ms(started_at),
                    )
                )
            except Exception:
                return self._observed(
                    AgentToolExecutionResult(
                        name=call.name,
                        result=_safe_result("FAILED", "internal_tool_error"),
                        status="FAILED",
                        code="internal_tool_error",
                        attempts=attempt,
                        duration_ms=self._elapsed_ms(started_at),
                    )
                )

            duration_ms = self._elapsed_ms(started_at)
            if duration_ms > round(tool.timeout_seconds * 1000):
                return self._observed(
                    AgentToolExecutionResult(
                        name=call.name,
                        result=_safe_result("DEGRADED", "tool_timeout"),
                        status="DEGRADED",
                        code="tool_timeout",
                        attempts=attempt,
                        duration_ms=duration_ms,
                    )
                )
            return self._observed(
                AgentToolExecutionResult(
                    name=call.name,
                    result=handled.result,
                    status=handled.status,
                    code=handled.code,
                    attempts=attempt,
                    duration_ms=duration_ms,
                    item_count=handled.item_count,
                )
            )

        raise AssertionError("agent tool retry loop exited unexpectedly")

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        return max(0, round((monotonic() - started_at) * 1000))

    def _rejected(
        self,
        *,
        name: str,
        code: str,
        started_at: float,
    ) -> AgentToolExecutionResult:
        return self._observed(
            AgentToolExecutionResult(
                name=name,
                result=_safe_result("REJECTED", code),
                status="REJECTED",
                code=code,
                attempts=0,
                duration_ms=self._elapsed_ms(started_at),
            )
        )

    @staticmethod
    def _observed(result: AgentToolExecutionResult) -> AgentToolExecutionResult:
        labels = {"tool": result.name, "status": result.status}
        metrics.increment("memora_agent_tool_executions_total", labels=labels)
        metrics.observe(
            "memora_agent_tool_duration_seconds",
            labels=labels,
            value=result.duration_ms / 1000,
        )
        return result
