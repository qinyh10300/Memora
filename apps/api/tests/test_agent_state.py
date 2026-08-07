import pytest

from memora.agent.state import (
    InvalidAgentExecutionTransition,
    execution_status_for_trace_step,
    transition_execution_status,
)


def test_agent_execution_state_machine_accepts_public_runtime_path() -> None:
    status = transition_execution_status("RECEIVED", "PLANNING")
    status = transition_execution_status(status, "TOOL_PENDING")
    status = transition_execution_status(status, "TOOL_RUNNING")
    status = transition_execution_status(status, "MODEL_RUNNING")
    status = transition_execution_status(status, "COMPLETED")

    assert status == "COMPLETED"
    assert transition_execution_status(status, "COMPLETED") == "COMPLETED"


def test_agent_execution_state_machine_rejects_terminal_and_unknown_transitions() -> None:
    with pytest.raises(InvalidAgentExecutionTransition):
        transition_execution_status("COMPLETED", "MODEL_RUNNING")
    with pytest.raises(InvalidAgentExecutionTransition):
        transition_execution_status("UNKNOWN", "FAILED")


def test_trace_steps_map_to_public_execution_phases_without_hidden_reasoning() -> None:
    status = execution_status_for_trace_step(
        "RECEIVED",
        kind="ANALYSIS",
        status="RUNNING",
    )
    assert status == "PLANNING"
    status = execution_status_for_trace_step(status, kind="MODEL", status="RUNNING")
    assert status == "MODEL_RUNNING"
    status = execution_status_for_trace_step(status, kind="TOOL", status="RUNNING")
    assert status == "TOOL_RUNNING"
    assert (
        execution_status_for_trace_step(status, kind="OUTPUT", status="COMPLETED") == "TOOL_RUNNING"
    )
