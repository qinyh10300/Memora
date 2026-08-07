from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from memora.agent.schemas import AgentExecutionResponse, agent_execution_response_for
from memora.agent.service import (
    get_owned_execution,
    list_execution_events,
    request_execution_cancel,
)
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal

router = APIRouter(prefix="/agent/executions", tags=["agent"])


@router.get("/{execution_id}", response_model=AgentExecutionResponse)
def get_agent_execution(
    execution_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    after_sequence: Annotated[int, Query(ge=0)] = 0,
) -> AgentExecutionResponse:
    execution = get_owned_execution(
        database,
        execution_id=execution_id,
        workspace_id=principal.workspace_id,
        actor_id=principal.user_id,
    )
    if execution is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="执行记录不存在")
    events = list_execution_events(database, execution.id, after_sequence=after_sequence)
    return agent_execution_response_for(execution, events)


@router.post("/{execution_id}/cancel", response_model=AgentExecutionResponse)
def cancel_agent_execution(
    execution_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> AgentExecutionResponse:
    execution = get_owned_execution(
        database,
        execution_id=execution_id,
        workspace_id=principal.workspace_id,
        actor_id=principal.user_id,
    )
    if execution is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="执行记录不存在")
    request_execution_cancel(database, execution)
    database.refresh(execution)
    events = list_execution_events(database, execution.id, after_sequence=0)
    return agent_execution_response_for(execution, events)
