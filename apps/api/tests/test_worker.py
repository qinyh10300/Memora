from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from memora.ai.ports import AIProviderError, EmbeddingBatch, ModelUsage
from memora.database import Base, build_engine
from memora.identity.models import User
from memora.identity.seed import seed_database
from memora.jobs.embedding import (
    claim_next_embedding_job,
    complete_embedding_job,
    process_next_embedding_job,
)
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding
from memora.settings import Settings
from memora.workspaces.models import Workspace


class FakeEmbeddingModel:
    model_id = "fake-embedding-v1"

    def __init__(self, error: AIProviderError | None = None) -> None:
        self.error = error
        self.inputs: list[list[str]] = []

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        self.inputs.append(texts)
        if self.error is not None:
            raise self.error
        return EmbeddingBatch(
            vectors=[[0.25, 0.75]],
            model=self.model_id,
            usage=ModelUsage(input_tokens=7),
        )


@pytest.fixture
def worker_database() -> Iterator[tuple[Engine, Settings]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="worker-test-secret-not-for-production",
        ai_job_retry_base_seconds=2,
        ai_embedding_max_attempts=3,
    )
    engine = build_engine(settings.database_url)
    Base.metadata.create_all(engine)
    seed_database(engine, settings)
    try:
        yield engine, settings
    finally:
        engine.dispose()


def _add_memory_job(engine: Engine, body: str = "需要异步生成向量的想法") -> tuple[UUID, UUID]:
    with Session(engine) as database, database.begin():
        user = database.scalar(select(User).where(User.email == "alex@memora.local"))
        workspace = database.scalar(select(Workspace).where(Workspace.slug == "memora-test"))
        assert user is not None and workspace is not None
        memory = Memory(
            id=uuid4(),
            workspace_id=workspace.id,
            author_id=user.id,
            body=body,
            visibility="PRIVATE",
        )
        database.add(memory)
        database.flush()
        database.add(MemoryEmbedding(memory_id=memory.id, status="PENDING"))
        job = Job(
            workspace_id=workspace.id,
            type="EMBED_MEMORY",
            payload_ref=memory.id,
            status="PENDING",
        )
        database.add(job)
        database.flush()
        return memory.id, job.id


def test_missing_configuration_keeps_memory_and_surfaces_waiting_state(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    now = datetime.now(UTC)

    assert process_next_embedding_job(engine, settings, None, now=now) is True

    with Session(engine) as database:
        memory = database.get(Memory, memory_id)
        job = database.get(Job, job_id)
        projection = database.get(MemoryEmbedding, memory_id)
    assert memory is not None and memory.body == "需要异步生成向量的想法"
    assert job is not None and job.status == "WAITING_CONFIGURATION" and job.attempts == 0
    assert job.next_run_at is not None
    assert projection is not None and projection.status == "WAITING_CONFIGURATION"
    assert projection.embedding is None


def test_successful_job_persists_projection_usage_and_completes_outbox(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    model = FakeEmbeddingModel()

    assert process_next_embedding_job(engine, settings, model) is True

    with Session(engine) as database:
        job = database.get(Job, job_id)
        projection = database.get(MemoryEmbedding, memory_id)
    assert model.inputs == [["需要异步生成向量的想法"]]
    assert job is not None and job.status == "COMPLETED" and job.next_run_at is None
    assert projection is not None
    assert projection.status == "COMPLETED"
    assert projection.model == "fake-embedding-v1"
    assert projection.dimensions == 2
    assert list(projection.embedding or []) == pytest.approx([0.25, 0.75])
    assert projection.usage_tokens == 7


def test_retryable_failure_uses_backoff_then_can_recover(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    now = datetime.now(UTC)
    failing = FakeEmbeddingModel(AIProviderError("provider_timeout", retryable=True))

    assert process_next_embedding_job(engine, settings, failing, now=now) is True
    with Session(engine) as database:
        failed_job = database.get(Job, job_id)
        assert failed_job is not None
        next_run_at = failed_job.next_run_at
        assert failed_job.status == "FAILED" and failed_job.attempts == 1
        assert next_run_at is not None

    recovered = FakeEmbeddingModel()
    assert (
        process_next_embedding_job(
            engine,
            settings,
            recovered,
            now=now + timedelta(seconds=3),
        )
        is True
    )
    with Session(engine) as database:
        job = database.get(Job, job_id)
        projection = database.get(MemoryEmbedding, memory_id)
    assert job is not None and job.status == "COMPLETED" and job.attempts == 2
    assert projection is not None and projection.status == "COMPLETED"


def test_non_retryable_failure_stops_without_losing_memory(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    model = FakeEmbeddingModel(AIProviderError("authentication_failed", retryable=False))

    assert process_next_embedding_job(engine, settings, model) is True

    with Session(engine) as database:
        job = database.get(Job, job_id)
        memory = database.get(Memory, memory_id)
        projection = database.get(MemoryEmbedding, memory_id)
    assert job is not None and job.status == "FAILED" and job.next_run_at is None
    assert memory is not None and memory.body is not None
    assert projection is not None and projection.last_error_code == "authentication_failed"


def test_completion_after_concurrent_delete_cannot_restore_projection(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, _settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    claimed = claim_next_embedding_job(engine, datetime.now(UTC))
    assert claimed is not None
    with Session(engine) as database, database.begin():
        memory = database.get(Memory, memory_id)
        job = database.get(Job, job_id)
        assert memory is not None and job is not None
        memory.body = None
        memory.deleted_at = datetime.now(UTC)
        job.status = "CANCELLED"

    complete_embedding_job(
        engine,
        claimed,
        vector=[0.25, 0.75],
        model="fake-embedding-v1",
        usage_tokens=7,
    )

    with Session(engine) as database:
        assert database.get(MemoryEmbedding, memory_id) is None
        job = database.get(Job, job_id)
        assert job is not None and job.status == "CANCELLED"


def test_stale_running_job_is_reclaimed_after_lease_expires(
    worker_database: tuple[Engine, Settings],
) -> None:
    engine, settings = worker_database
    memory_id, job_id = _add_memory_job(engine)
    now = datetime.now(UTC)
    with Session(engine) as database, database.begin():
        job = database.get(Job, job_id)
        assert job is not None
        job.status = "RUNNING"
        job.attempts = 1
        job.locked_at = now - timedelta(minutes=10)

    assert process_next_embedding_job(engine, settings, FakeEmbeddingModel(), now=now) is True

    with Session(engine) as database:
        job = database.get(Job, job_id)
        projection = database.get(MemoryEmbedding, memory_id)
    assert job is not None and job.status == "COMPLETED" and job.attempts == 2
    assert projection is not None and projection.status == "COMPLETED"
