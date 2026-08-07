import json
from time import sleep

from pydantic import BaseModel, ConfigDict, Field

from memora.agent.tools import (
    AgentToolFailure,
    AgentToolHandler,
    AgentToolHandlerResult,
    AgentToolInvocation,
    AgentToolPolicy,
    AgentToolPolicyDecision,
    AgentToolRegistry,
)
from memora.ai.ports import ChatToolCall, ChatToolDefinition, ChatToolResult


class ExampleToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str = Field(min_length=1, max_length=20)


def _definition(name: str = "example") -> ChatToolDefinition:
    return ChatToolDefinition(
        name=name,
        description="A deterministic test tool.",
        parameters=ExampleToolArguments.model_json_schema(),
    )


def _success_handler(
    arguments: BaseModel,
    invocation: AgentToolInvocation,
) -> AgentToolHandlerResult:
    parsed = ExampleToolArguments.model_validate(arguments)
    return AgentToolHandlerResult(
        result=ChatToolResult(
            content=json.dumps(
                {"status": "completed", "value": parsed.value, "attempt": invocation.attempt}
            )
        ),
        status="COMPLETED",
        code="completed",
        item_count=1,
    )


def _allow(_arguments: BaseModel) -> AgentToolPolicyDecision:
    return AgentToolPolicyDecision.allow()


def _registry(
    *,
    handler: AgentToolHandler = _success_handler,
    policy: AgentToolPolicy = _allow,
    timeout_seconds: float = 1,
    max_attempts: int = 1,
    max_calls: int = 1,
    exposed: bool = True,
) -> AgentToolRegistry:
    registry = AgentToolRegistry()
    registry.register(
        definition=_definition(),
        arguments_model=ExampleToolArguments,
        handler=handler,
        policy=policy,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
        max_calls=max_calls,
        exposed=exposed,
    )
    return registry


def test_registry_exposes_schema_and_executes_typed_handler() -> None:
    registry = _registry(max_calls=2)

    assert [definition.name for definition in registry.definitions()] == ["example"]
    outcome = registry.execute(
        ChatToolCall(id="call-1", name="example", arguments={"value": "visible"})
    )

    assert outcome.status == "COMPLETED"
    assert outcome.code == "completed"
    assert outcome.attempts == 1
    assert outcome.item_count == 1
    assert json.loads(outcome.result.content) == {
        "status": "completed",
        "value": "visible",
        "attempt": 1,
    }


def test_registry_rejects_unknown_invalid_denied_and_excess_calls_safely() -> None:
    private_marker = "PRIVATE_MARKER_d50a"

    def deny(_arguments: BaseModel) -> AgentToolPolicyDecision:
        return AgentToolPolicyDecision.deny("permission_denied")

    unknown = _registry().execute(
        ChatToolCall(id="unknown", name=private_marker, arguments={"value": "x"})
    )
    invalid = _registry().execute(
        ChatToolCall(id="invalid", name="example", arguments={"value": "", "extra": private_marker})
    )
    denied = _registry(policy=deny).execute(
        ChatToolCall(id="denied", name="example", arguments={"value": private_marker})
    )
    limited_registry = _registry()
    limited_registry.execute(ChatToolCall(id="first", name="example", arguments={"value": "first"}))
    limited = limited_registry.execute(
        ChatToolCall(id="second", name="example", arguments={"value": private_marker})
    )

    assert [unknown.code, invalid.code, denied.code, limited.code] == [
        "unknown_tool",
        "invalid_tool_arguments",
        "permission_denied",
        "tool_call_limit_exceeded",
    ]
    safe_payload = " ".join(
        outcome.result.content for outcome in (unknown, invalid, denied, limited)
    )
    assert private_marker not in safe_payload


def test_registry_retries_bounded_provider_errors_and_hides_internal_failures() -> None:
    attempts = 0

    def flaky_handler(
        _arguments: BaseModel,
        _invocation: AgentToolInvocation,
    ) -> AgentToolHandlerResult:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise AgentToolFailure("provider_timeout", retryable=True)
        return AgentToolHandlerResult(
            result=ChatToolResult(content='{"status":"completed"}'),
            status="COMPLETED",
            code="completed",
        )

    recovered = _registry(handler=flaky_handler, max_attempts=2).execute(
        ChatToolCall(id="retry", name="example", arguments={"value": "retry"})
    )

    def broken_handler(
        _arguments: BaseModel,
        _invocation: AgentToolInvocation,
    ) -> AgentToolHandlerResult:
        raise RuntimeError("PRIVATE_INTERNAL_EXCEPTION_783c")

    failed = _registry(handler=broken_handler).execute(
        ChatToolCall(id="broken", name="example", arguments={"value": "broken"})
    )

    assert recovered.status == "COMPLETED"
    assert recovered.attempts == 2
    assert failed.status == "FAILED"
    assert failed.code == "internal_tool_error"
    assert "PRIVATE_INTERNAL_EXCEPTION_783c" not in failed.result.content


def test_registry_enforces_elapsed_timeout_and_can_hide_definition() -> None:
    def slow_handler(
        _arguments: BaseModel,
        _invocation: AgentToolInvocation,
    ) -> AgentToolHandlerResult:
        sleep(0.01)
        return AgentToolHandlerResult(
            result=ChatToolResult(content='{"status":"completed"}'),
            status="COMPLETED",
            code="completed",
        )

    registry = _registry(handler=slow_handler, timeout_seconds=0.001, exposed=False)
    outcome = registry.execute(ChatToolCall(id="slow", name="example", arguments={"value": "slow"}))

    assert registry.definitions() == []
    assert outcome.status == "DEGRADED"
    assert outcome.code == "tool_timeout"
    assert json.loads(outcome.result.content) == {
        "status": "degraded",
        "reason": "tool_timeout",
    }
