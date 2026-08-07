from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from memora.agent.models import AgentEvent, AgentExecution
from memora.agent.state import (
    TERMINAL_EXECUTION_STATUSES,
    AgentExecutionStatus,
    as_execution_status,
    execution_status_for_trace_step,
    transition_execution_status,
)


class SafeTraceStep(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def kind(self) -> str: ...

    @property
    def status(self) -> str: ...

    @property
    def title(self) -> str: ...

    @property
    def detail(self) -> str | None: ...

    @property
    def elapsed_ms(self) -> int: ...

    @property
    def duration_ms(self) -> int | None: ...

    @property
    def item_count(self) -> int | None: ...


class AgentCancelled(RuntimeError):
    pass


def _persisted_event_detail(step: SafeTraceStep) -> str | None:
    if (
        step.id.startswith("tool-web-search")
        and step.detail is not None
        and step.detail.startswith("查询：")
    ):
        return "已提交受控联网查询；查询文本不写入执行日志。"
    return step.detail[:500] if step.detail is not None else None


def create_agent_execution(
    session_factory: sessionmaker[Session],
    *,
    execution_id: UUID,
    workspace_id: UUID,
    actor_id: UUID,
    model_id: str | None,
) -> None:
    with session_factory.begin() as database:
        database.add(
            AgentExecution(
                id=execution_id,
                workspace_id=workspace_id,
                actor_id=actor_id,
                status="RECEIVED",
                model_id=model_id,
            )
        )


class AgentExecutionRecorder:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        execution_id: UUID,
    ) -> None:
        self._session_factory = session_factory
        self.execution_id = execution_id

    def append_step(self, step: SafeTraceStep) -> int:
        with self._session_factory.begin() as database:
            execution = database.scalar(
                select(AgentExecution)
                .where(AgentExecution.id == self.execution_id)
                .with_for_update()
            )
            if execution is None:
                raise RuntimeError("agent execution disappeared")
            if execution.status in {"CANCEL_REQUESTED", "CANCELLED"}:
                raise AgentCancelled("agent execution was cancelled")
            if execution.status in TERMINAL_EXECUTION_STATUSES:
                raise RuntimeError("cannot append an event to a terminal agent execution")
            if execution.started_at is None:
                execution.started_at = datetime.now(UTC)
            execution.status = execution_status_for_trace_step(
                execution.status,
                kind=step.kind,
                status=step.status,
            )
            sequence = execution.next_event_sequence
            execution.next_event_sequence += 1
            database.add(
                AgentEvent(
                    execution_id=execution.id,
                    sequence=sequence,
                    step_id=step.id,
                    kind=step.kind,
                    status=step.status,
                    execution_status=execution.status,
                    title=step.title,
                    detail=_persisted_event_detail(step),
                    elapsed_ms=step.elapsed_ms,
                    duration_ms=step.duration_ms,
                    item_count=step.item_count,
                )
            )
            return sequence

    def is_cancel_requested(self) -> bool:
        with self._session_factory() as database:
            status = database.scalar(
                select(AgentExecution.status).where(AgentExecution.id == self.execution_id)
            )
            return status in {"CANCEL_REQUESTED", "CANCELLED"}

    def transition(self, status: AgentExecutionStatus) -> None:
        with self._session_factory.begin() as database:
            execution = database.get(AgentExecution, self.execution_id)
            if execution is None:
                raise RuntimeError("agent execution disappeared")
            execution.status = transition_execution_status(execution.status, status)
            if execution.started_at is None and status != "RECEIVED":
                execution.started_at = datetime.now(UTC)

    def finish(self, status: str, *, model_id: str | None = None) -> None:
        target = as_execution_status(status)
        if target not in TERMINAL_EXECUTION_STATUSES:
            raise ValueError("invalid terminal agent execution status")
        with self._session_factory.begin() as database:
            execution = database.get(AgentExecution, self.execution_id)
            if execution is None:
                raise RuntimeError("agent execution disappeared")
            if execution.status == "CANCEL_REQUESTED":
                target = "CANCELLED"
            execution.status = transition_execution_status(execution.status, target)
            execution.model_id = model_id or execution.model_id
            execution.completed_at = datetime.now(UTC)

    def fail(self, error_code: str) -> None:
        with self._session_factory.begin() as database:
            execution = database.get(AgentExecution, self.execution_id)
            if execution is None:
                raise RuntimeError("agent execution disappeared")
            if execution.status in TERMINAL_EXECUTION_STATUSES:
                return
            target: AgentExecutionStatus = (
                "CANCELLED" if execution.status == "CANCEL_REQUESTED" else "FAILED"
            )
            execution.status = transition_execution_status(execution.status, target)
            execution.error_code = error_code[:80]
            execution.completed_at = datetime.now(UTC)


def get_owned_execution(
    database: Session,
    *,
    execution_id: UUID,
    workspace_id: UUID,
    actor_id: UUID,
) -> AgentExecution | None:
    return database.scalar(
        select(AgentExecution).where(
            AgentExecution.id == execution_id,
            AgentExecution.workspace_id == workspace_id,
            AgentExecution.actor_id == actor_id,
        )
    )


def list_execution_events(
    database: Session,
    execution_id: UUID,
    *,
    after_sequence: int,
) -> list[AgentEvent]:
    return list(
        database.scalars(
            select(AgentEvent)
            .where(
                AgentEvent.execution_id == execution_id,
                AgentEvent.sequence > after_sequence,
            )
            .order_by(AgentEvent.sequence)
        )
    )


def request_execution_cancel(database: Session, execution: AgentExecution) -> None:
    if execution.status in TERMINAL_EXECUTION_STATUSES:
        return
    execution.status = transition_execution_status(execution.status, "CANCEL_REQUESTED")
    database.commit()
