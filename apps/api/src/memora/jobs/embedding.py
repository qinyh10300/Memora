from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy import Engine, Select, and_, or_, select
from sqlalchemy.orm import Session

from memora.ai.ports import AIProviderError, EmbeddingModelPort
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding
from memora.settings import Settings

RUNNING_LEASE_SECONDS = 300
WAITING_CONFIGURATION_SECONDS = 60
MAX_RETRY_DELAY_SECONDS = 3600


@dataclass(frozen=True)
class ClaimedEmbeddingJob:
    job_id: UUID
    memory_id: UUID
    body: str
    attempts: int


def _eligible_job_statement(now: datetime) -> Select[tuple[Job]]:
    stale_before = now - timedelta(seconds=RUNNING_LEASE_SECONDS)
    return (
        select(Job)
        .where(
            Job.type == "EMBED_MEMORY",
            or_(
                and_(
                    Job.status.in_(("PENDING", "FAILED", "WAITING_CONFIGURATION")),
                    Job.next_run_at.is_not(None),
                    Job.next_run_at <= now,
                ),
                and_(
                    Job.status == "RUNNING",
                    Job.locked_at.is_not(None),
                    Job.locked_at < stale_before,
                ),
            ),
        )
        .order_by(Job.next_run_at, Job.created_at, Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )


def mark_next_job_waiting_for_configuration(engine: Engine, now: datetime) -> bool:
    with Session(engine) as database, database.begin():
        job = database.scalar(_eligible_job_statement(now))
        if job is None:
            return False
        memory = database.get(Memory, job.payload_ref)
        if memory is None or memory.deleted_at is not None or memory.body is None:
            job.status = "CANCELLED"
            job.next_run_at = None
            job.locked_at = None
            projection = database.get(MemoryEmbedding, job.payload_ref)
            if projection is not None:
                database.delete(projection)
            return True
        projection = database.get(MemoryEmbedding, memory.id)
        if projection is None:
            projection = MemoryEmbedding(memory_id=memory.id)
            database.add(projection)
        job.status = "WAITING_CONFIGURATION"
        job.next_run_at = now + timedelta(seconds=WAITING_CONFIGURATION_SECONDS)
        job.locked_at = None
        job.last_error_code = "embedding_not_configured"
        projection.status = "WAITING_CONFIGURATION"
        projection.last_error_code = "embedding_not_configured"
        return True


def claim_next_embedding_job(engine: Engine, now: datetime) -> ClaimedEmbeddingJob | None:
    with Session(engine) as database, database.begin():
        job = database.scalar(_eligible_job_statement(now))
        if job is None:
            return None
        memory = database.get(Memory, job.payload_ref)
        if memory is None or memory.deleted_at is not None or memory.body is None:
            job.status = "CANCELLED"
            job.next_run_at = None
            job.locked_at = None
            projection = database.get(MemoryEmbedding, job.payload_ref)
            if projection is not None:
                database.delete(projection)
            return None
        job.status = "RUNNING"
        job.attempts += 1
        job.locked_at = now
        job.last_error_code = None
        projection = database.get(MemoryEmbedding, memory.id)
        if projection is None:
            projection = MemoryEmbedding(memory_id=memory.id)
            database.add(projection)
        projection.status = "PENDING"
        projection.last_error_code = None
        return ClaimedEmbeddingJob(
            job_id=job.id,
            memory_id=memory.id,
            body=memory.body,
            attempts=job.attempts,
        )


def complete_embedding_job(
    engine: Engine,
    claimed: ClaimedEmbeddingJob,
    *,
    vector: list[float],
    model: str,
    usage_tokens: int,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(Job, claimed.job_id)
        memory = database.get(Memory, claimed.memory_id)
        if (
            job is None
            or job.status == "CANCELLED"
            or memory is None
            or memory.deleted_at is not None
            or memory.body is None
        ):
            projection = database.get(MemoryEmbedding, claimed.memory_id)
            if projection is not None:
                database.delete(projection)
            if job is not None:
                job.status = "CANCELLED"
                job.next_run_at = None
                job.locked_at = None
            return
        projection = database.get(MemoryEmbedding, claimed.memory_id)
        if projection is None:
            projection = MemoryEmbedding(memory_id=claimed.memory_id)
            database.add(projection)
        projection.status = "COMPLETED"
        projection.model = model
        projection.dimensions = len(vector)
        projection.embedding = vector
        projection.usage_tokens = usage_tokens
        projection.last_error_code = None
        job.status = "COMPLETED"
        job.next_run_at = None
        job.locked_at = None
        job.last_error_code = None


def fail_embedding_job(
    engine: Engine,
    claimed: ClaimedEmbeddingJob,
    error: AIProviderError,
    settings: Settings,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(Job, claimed.job_id)
        if job is None or job.status == "CANCELLED":
            return
        projection = database.get(MemoryEmbedding, claimed.memory_id)
        if projection is None:
            projection = MemoryEmbedding(memory_id=claimed.memory_id)
            database.add(projection)
        projection.status = "FAILED"
        projection.embedding = None
        projection.model = None
        projection.dimensions = None
        projection.last_error_code = error.code
        job.status = "FAILED"
        job.locked_at = None
        job.last_error_code = error.code
        if error.retryable and claimed.attempts < settings.ai_embedding_max_attempts:
            delay = min(
                settings.ai_job_retry_base_seconds * (2 ** (claimed.attempts - 1)),
                MAX_RETRY_DELAY_SECONDS,
            )
            job.next_run_at = now + timedelta(seconds=delay)
        else:
            job.next_run_at = None


def process_next_embedding_job(
    engine: Engine,
    settings: Settings,
    embedding_model: EmbeddingModelPort | None,
    *,
    now: datetime | None = None,
) -> bool:
    current_time = now or datetime.now(UTC)
    if embedding_model is None:
        return mark_next_job_waiting_for_configuration(engine, current_time)

    claimed = claim_next_embedding_job(engine, current_time)
    if claimed is None:
        return False
    logger = structlog.get_logger("memora.worker.embedding")
    try:
        batch = embedding_model.embed([claimed.body])
        vector = batch.vectors[0]
    except AIProviderError as error:
        fail_embedding_job(engine, claimed, error, settings, current_time)
        logger.warning(
            "embedding.failed",
            job_id=str(claimed.job_id),
            memory_id=str(claimed.memory_id),
            error_code=error.code,
            retryable=error.retryable,
            attempt=claimed.attempts,
        )
        return True
    complete_embedding_job(
        engine,
        claimed,
        vector=vector,
        model=batch.model,
        usage_tokens=batch.usage.input_tokens,
    )
    logger.info(
        "embedding.completed",
        job_id=str(claimed.job_id),
        memory_id=str(claimed.memory_id),
        model=batch.model,
        dimensions=len(vector),
        usage_tokens=batch.usage.input_tokens,
    )
    return True
