from typing import Literal

AgentExecutionStatus = Literal[
    "RECEIVED",
    "PLANNING",
    "TOOL_PENDING",
    "TOOL_RUNNING",
    "MODEL_RUNNING",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "COMPLETED",
    "DEGRADED",
    "FAILED",
]

TERMINAL_EXECUTION_STATUSES: frozenset[AgentExecutionStatus] = frozenset(
    {"CANCELLED", "COMPLETED", "DEGRADED", "FAILED"}
)

_ALLOWED_TRANSITIONS: dict[AgentExecutionStatus, frozenset[AgentExecutionStatus]] = {
    "RECEIVED": frozenset(
        {
            "PLANNING",
            "TOOL_PENDING",
            "TOOL_RUNNING",
            "MODEL_RUNNING",
            "CANCEL_REQUESTED",
            "CANCELLED",
            "COMPLETED",
            "DEGRADED",
            "FAILED",
        }
    ),
    "PLANNING": frozenset(
        {
            "TOOL_PENDING",
            "TOOL_RUNNING",
            "MODEL_RUNNING",
            "CANCEL_REQUESTED",
            "COMPLETED",
            "DEGRADED",
            "FAILED",
        }
    ),
    "TOOL_PENDING": frozenset(
        {
            "TOOL_RUNNING",
            "MODEL_RUNNING",
            "CANCEL_REQUESTED",
            "COMPLETED",
            "DEGRADED",
            "FAILED",
        }
    ),
    "TOOL_RUNNING": frozenset(
        {
            "TOOL_PENDING",
            "MODEL_RUNNING",
            "CANCEL_REQUESTED",
            "COMPLETED",
            "DEGRADED",
            "FAILED",
        }
    ),
    "MODEL_RUNNING": frozenset(
        {
            "TOOL_PENDING",
            "TOOL_RUNNING",
            "CANCEL_REQUESTED",
            "COMPLETED",
            "DEGRADED",
            "FAILED",
        }
    ),
    "CANCEL_REQUESTED": frozenset({"CANCELLED"}),
    "CANCELLED": frozenset(),
    "COMPLETED": frozenset(),
    "DEGRADED": frozenset(),
    "FAILED": frozenset(),
}


class InvalidAgentExecutionTransition(RuntimeError):
    pass


def as_execution_status(value: str) -> AgentExecutionStatus:
    if value not in _ALLOWED_TRANSITIONS:
        raise InvalidAgentExecutionTransition(f"unknown agent execution status: {value}")
    return value


def transition_execution_status(
    current: str,
    target: AgentExecutionStatus,
) -> AgentExecutionStatus:
    current_status = as_execution_status(current)
    if current_status == target:
        return target
    if target not in _ALLOWED_TRANSITIONS[current_status]:
        raise InvalidAgentExecutionTransition(
            f"invalid agent execution transition: {current_status} -> {target}"
        )
    return target


def execution_status_for_trace_step(
    current: str,
    *,
    kind: str,
    status: str,
) -> AgentExecutionStatus:
    current_status = as_execution_status(current)
    if kind == "ANALYSIS":
        return transition_execution_status(current_status, "PLANNING")
    if kind == "TOOL" and status == "RUNNING":
        return transition_execution_status(current_status, "TOOL_RUNNING")
    if kind == "MODEL" and status == "RUNNING":
        return transition_execution_status(current_status, "MODEL_RUNNING")
    if current_status == "RECEIVED":
        return transition_execution_status(current_status, "PLANNING")
    return current_status
