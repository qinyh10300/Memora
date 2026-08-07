from __future__ import annotations

from secrets import compare_digest
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from memora.documents.models import DocumentChunk, DocumentParseJob
from memora.identity.rate_limit import LoginRateLimiter
from memora.jobs.models import Job
from memora.observability import ObservabilityEventSink, metrics
from memora.settings import Settings, get_settings

router = APIRouter(tags=["observability"])
logger = structlog.get_logger("memora.api.observability")
SettingsDependency = Annotated[Settings, Depends(get_settings)]

_PARSE_JOB_STATUSES = (
    "QUEUED",
    "PARSING",
    "OCR",
    "COMPLETED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
)
_DOCUMENT_EMBEDDING_STATUSES = (
    "PENDING",
    "RUNNING",
    "WAITING_CONFIGURATION",
    "COMPLETED",
    "FAILED",
)
_MEMORY_EMBEDDING_STATUSES = (
    "PENDING",
    "RUNNING",
    "WAITING_CONFIGURATION",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
)


class ClientErrorReport(BaseModel):
    surface: Literal[
        "root",
        "auth",
        "workbench",
        "capture",
        "library",
        "team",
        "settings",
        "unknown",
    ] = "unknown"
    error_type: str = Field(
        default="Error",
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z][A-Za-z0-9_.-]*$",
    )
    digest: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    recovery_action: Literal["retry", "reload", "navigate_home", "none"] = "none"


def _refresh_database_metrics(engine: Engine) -> None:
    try:
        with Session(engine) as database:
            parse_counts: dict[str, int] = {
                job_status: count
                for job_status, count in database.execute(
                    select(DocumentParseJob.status, func.count()).group_by(DocumentParseJob.status)
                )
                .tuples()
                .all()
            }
            document_embedding_counts: dict[str, int] = {
                job_status: count
                for job_status, count in database.execute(
                    select(DocumentChunk.embedding_status, func.count()).group_by(
                        DocumentChunk.embedding_status
                    )
                )
                .tuples()
                .all()
            }
            memory_embedding_counts: dict[str, int] = {
                job_status: count
                for job_status, count in database.execute(
                    select(Job.status, func.count())
                    .where(Job.type == "EMBED_MEMORY")
                    .group_by(Job.status)
                )
                .tuples()
                .all()
            }
    except SQLAlchemyError:
        metrics.increment(
            "memora_metrics_collection_errors_total",
            labels={"collector": "database_queues"},
        )
        logger.warning("metrics.database_collection_failed")
        return

    for job_status in _PARSE_JOB_STATUSES:
        metrics.set_gauge(
            "memora_document_parse_jobs",
            labels={"status": job_status},
            value=float(parse_counts.get(job_status, 0)),
        )
    for job_status in _DOCUMENT_EMBEDDING_STATUSES:
        metrics.set_gauge(
            "memora_document_embedding_chunks",
            labels={"status": job_status},
            value=float(document_embedding_counts.get(job_status, 0)),
        )
    for job_status in _MEMORY_EMBEDDING_STATUSES:
        metrics.set_gauge(
            "memora_memory_embedding_jobs",
            labels={"status": job_status},
            value=float(memory_embedding_counts.get(job_status, 0)),
        )


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def prometheus_metrics(request: Request, settings: SettingsDependency) -> PlainTextResponse:
    if not settings.metrics_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    supplied_credential = request.headers.get("authorization", "")
    expected_credential = f"Bearer {settings.metrics_token.get_secret_value()}"
    if not compare_digest(supplied_credential, expected_credential):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    _refresh_database_metrics(request.app.state.engine)
    return PlainTextResponse(
        metrics.render_prometheus(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.post("/client-errors", status_code=status.HTTP_202_ACCEPTED)
def report_client_error(payload: ClientErrorReport, request: Request) -> Response:
    limiter: LoginRateLimiter = request.app.state.client_error_rate_limiter
    client_key = request.client.host if request.client is not None else "unknown"
    if not limiter.consume(client_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    metrics.increment(
        "memora_client_errors_total",
        labels={"surface": payload.surface, "error_type": payload.error_type},
    )
    logger.warning(
        "client.error_reported",
        surface=payload.surface,
        error_type=payload.error_type,
        digest=payload.digest,
        recovery_action=payload.recovery_action,
    )
    sink: ObservabilityEventSink = request.app.state.observability_event_sink
    sink.send(
        {
            "event": "client.error_reported",
            "surface": payload.surface,
            "error_type": payload.error_type,
            "digest": payload.digest,
            "recovery_action": payload.recovery_action,
        }
    )
    return Response(status_code=status.HTTP_202_ACCEPTED)
