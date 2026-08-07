from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from memora.agent.models import AgentEvent, AgentExecution
from memora.agent.state import AgentExecutionStatus, as_execution_status


class AgentEventResponse(BaseModel):
    sequence: int = Field(ge=1)
    step_id: str
    kind: str
    status: str
    execution_status: AgentExecutionStatus
    title: str
    detail: str | None
    elapsed_ms: int = Field(ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    item_count: int | None = Field(default=None, ge=0)
    created_at: datetime


class AgentExecutionResponse(BaseModel):
    id: UUID
    status: AgentExecutionStatus
    model_id: str | None
    saved_memory_id: UUID | None
    error_code: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    next_event_sequence: int = Field(ge=1)
    events: list[AgentEventResponse]


def agent_event_response_for(event: AgentEvent) -> AgentEventResponse:
    return AgentEventResponse(
        sequence=event.sequence,
        step_id=event.step_id,
        kind=event.kind,
        status=event.status,
        execution_status=as_execution_status(event.execution_status),
        title=event.title,
        detail=event.detail,
        elapsed_ms=event.elapsed_ms,
        duration_ms=event.duration_ms,
        item_count=event.item_count,
        created_at=event.created_at,
    )


def agent_execution_response_for(
    execution: AgentExecution,
    events: list[AgentEvent],
) -> AgentExecutionResponse:
    return AgentExecutionResponse(
        id=execution.id,
        status=as_execution_status(execution.status),
        model_id=execution.model_id,
        saved_memory_id=execution.saved_memory_id,
        error_code=execution.error_code,
        created_at=execution.created_at,
        started_at=execution.started_at,
        completed_at=execution.completed_at,
        next_event_sequence=execution.next_event_sequence,
        events=[agent_event_response_for(event) for event in events],
    )
