from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy import Engine, Select, and_, delete, func, or_, select
from sqlalchemy.orm import Session

from memora.ai.ports import AIProviderError, EmbeddingModelPort
from memora.assets.models import Asset
from memora.documents.models import DocumentChunk, DocumentPage, DocumentParseJob
from memora.documents.parser import (
    DocumentParseCancelled,
    DocumentParseError,
    DocumentParseLimits,
    OcrEngine,
    ParsedDocument,
    TesseractOcrEngine,
    parse_pdf_document,
)
from memora.settings import Settings

RUNNING_LEASE_SECONDS = 300
MAX_RETRY_DELAY_SECONDS = 3600
WAITING_CONFIGURATION_SECONDS = 60
DOCUMENT_EMBEDDING_BATCH_SIZE = 16


@dataclass(frozen=True)
class ClaimedDocumentJob:
    job_id: UUID
    asset_id: UUID
    workspace_id: UUID
    owner_id: UUID
    content: bytes
    attempts: int


@dataclass(frozen=True)
class ClaimedDocumentChunkBatch:
    chunk_ids: tuple[UUID, ...]
    texts: tuple[str, ...]
    attempts: tuple[int, ...]


def _eligible_parse_job_statement(now: datetime) -> Select[tuple[DocumentParseJob]]:
    stale_before = now - timedelta(seconds=RUNNING_LEASE_SECONDS)
    return (
        select(DocumentParseJob)
        .where(
            or_(
                and_(
                    DocumentParseJob.status.in_(("QUEUED", "FAILED")),
                    DocumentParseJob.next_run_at.is_not(None),
                    DocumentParseJob.next_run_at <= now,
                ),
                and_(
                    DocumentParseJob.status.in_(("PARSING", "OCR")),
                    DocumentParseJob.locked_at.is_not(None),
                    DocumentParseJob.locked_at < stale_before,
                ),
            )
        )
        .order_by(DocumentParseJob.next_run_at, DocumentParseJob.created_at, DocumentParseJob.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )


def claim_next_document_job(
    engine: Engine,
    settings: Settings,
    now: datetime,
) -> ClaimedDocumentJob | None:
    stale_before = now - timedelta(seconds=RUNNING_LEASE_SECONDS)
    with Session(engine) as database, database.begin():
        active_count = database.scalar(
            select(func.count(DocumentParseJob.id)).where(
                DocumentParseJob.status.in_(("PARSING", "OCR")),
                DocumentParseJob.locked_at.is_not(None),
                DocumentParseJob.locked_at >= stale_before,
            )
        )
        if int(active_count or 0) >= settings.document_parse_max_concurrency:
            return None
        job = database.scalar(_eligible_parse_job_statement(now))
        if job is None:
            return None
        asset = database.get(Asset, job.asset_id)
        if asset is None or asset.deleted_at is not None or asset.kind != "PDF":
            job.status = "CANCELLED"
            job.next_run_at = None
            job.locked_at = None
            job.completed_at = now
            return None
        job.status = "PARSING"
        job.attempts += 1
        job.page_count = None
        job.processed_pages = 0
        job.text_page_count = 0
        job.ocr_page_count = 0
        job.chunk_count = 0
        job.locked_at = now
        job.next_run_at = None
        job.error_code = None
        job.warning_code = None
        job.completed_at = None
        return ClaimedDocumentJob(
            job_id=job.id,
            asset_id=asset.id,
            workspace_id=asset.workspace_id,
            owner_id=asset.owner_id,
            content=asset.content,
            attempts=job.attempts,
        )


def update_document_progress(
    engine: Engine,
    claimed: ClaimedDocumentJob,
    phase: str,
    processed_pages: int,
    page_count: int,
) -> bool:
    with Session(engine) as database, database.begin():
        job = database.get(DocumentParseJob, claimed.job_id)
        asset = database.get(Asset, claimed.asset_id)
        if (
            job is None
            or asset is None
            or asset.deleted_at is not None
            or job.status in {"CANCEL_REQUESTED", "CANCELLED"}
        ):
            if job is not None:
                job.status = "CANCELLED"
                job.next_run_at = None
                job.locked_at = None
                job.completed_at = datetime.now(UTC)
            return False
        job.status = "OCR" if phase == "OCR" else "PARSING"
        job.page_count = page_count
        job.processed_pages = min(processed_pages, page_count)
        job.locked_at = datetime.now(UTC)
        return True


def complete_document_job(
    engine: Engine,
    claimed: ClaimedDocumentJob,
    parsed: ParsedDocument,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(DocumentParseJob, claimed.job_id)
        asset = database.get(Asset, claimed.asset_id)
        if (
            job is None
            or asset is None
            or asset.deleted_at is not None
            or job.status in {"CANCEL_REQUESTED", "CANCELLED"}
        ):
            if job is not None:
                job.status = "CANCELLED"
                job.next_run_at = None
                job.locked_at = None
                job.completed_at = now
            return
        database.execute(delete(DocumentPage).where(DocumentPage.parse_job_id == job.id))
        database.execute(delete(DocumentChunk).where(DocumentChunk.parse_job_id == job.id))
        for page in parsed.pages:
            database.add(
                DocumentPage(
                    parse_job_id=job.id,
                    asset_id=asset.id,
                    workspace_id=asset.workspace_id,
                    owner_id=asset.owner_id,
                    page_number=page.page_number,
                    extraction_method=page.extraction_method,
                    title=page.title,
                    text=page.text,
                    char_count=page.char_count,
                    quality_score=page.quality_score,
                )
            )
        for ordinal, chunk in enumerate(parsed.chunks):
            database.add(
                DocumentChunk(
                    parse_job_id=job.id,
                    asset_id=asset.id,
                    workspace_id=asset.workspace_id,
                    owner_id=asset.owner_id,
                    page_number=chunk.page_number,
                    ordinal=ordinal,
                    heading=chunk.heading,
                    text=chunk.text,
                    char_start=chunk.char_start,
                    char_end=chunk.char_end,
                    embedding_status="PENDING",
                )
            )
        job.status = "COMPLETED"
        job.page_count = len(parsed.pages)
        job.processed_pages = len(parsed.pages)
        job.text_page_count = sum(bool(page.text) for page in parsed.pages)
        job.ocr_page_count = sum(page.extraction_method == "OCR" for page in parsed.pages)
        job.chunk_count = len(parsed.chunks)
        job.next_run_at = None
        job.locked_at = None
        job.completed_at = now
        job.error_code = None
        job.warning_code = parsed.warning_code


def fail_document_job(
    engine: Engine,
    claimed: ClaimedDocumentJob,
    error: DocumentParseError,
    settings: Settings,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        job = database.get(DocumentParseJob, claimed.job_id)
        if job is None:
            return
        if isinstance(error, DocumentParseCancelled) or job.status == "CANCEL_REQUESTED":
            job.status = "CANCELLED"
            job.next_run_at = None
            job.locked_at = None
            job.completed_at = now
            job.error_code = None
            return
        job.status = "FAILED"
        job.locked_at = None
        job.completed_at = now
        job.error_code = error.code
        if error.retryable and claimed.attempts < settings.document_parse_max_attempts:
            delay = min(
                settings.ai_job_retry_base_seconds * (2 ** (claimed.attempts - 1)),
                MAX_RETRY_DELAY_SECONDS,
            )
            job.next_run_at = now + timedelta(seconds=delay)
        else:
            job.next_run_at = None


def process_next_document_job(
    engine: Engine,
    settings: Settings,
    *,
    now: datetime | None = None,
    ocr_engine: OcrEngine | None = None,
) -> bool:
    current_time = now or datetime.now(UTC)
    claimed = claim_next_document_job(engine, settings, current_time)
    if claimed is None:
        return False
    logger = structlog.get_logger("memora.worker.document")
    ocr = ocr_engine or TesseractOcrEngine(language=settings.document_ocr_languages)
    limits = DocumentParseLimits(
        max_pages=settings.document_parse_max_pages,
        max_total_chars=settings.document_parse_max_chars,
        max_chunk_chars=settings.document_chunk_max_chars,
        chunk_overlap_chars=settings.document_chunk_overlap_chars,
        min_text_chars_for_ocr=settings.document_ocr_min_text_chars,
        timeout_seconds=settings.document_parse_timeout_seconds,
        ocr_page_timeout_seconds=settings.document_ocr_page_timeout_seconds,
    )
    try:
        parsed = parse_pdf_document(
            claimed.content,
            limits=limits,
            ocr=ocr,
            progress=lambda phase, processed, total: update_document_progress(
                engine,
                claimed,
                phase,
                processed,
                total,
            ),
        )
    except DocumentParseError as error:
        fail_document_job(engine, claimed, error, settings, current_time)
        logger.warning(
            "document.failed",
            job_id=str(claimed.job_id),
            asset_id=str(claimed.asset_id),
            error_code=error.code,
            retryable=error.retryable,
            attempt=claimed.attempts,
        )
        return True
    complete_document_job(engine, claimed, parsed, current_time)
    logger.info(
        "document.completed",
        job_id=str(claimed.job_id),
        asset_id=str(claimed.asset_id),
        pages=len(parsed.pages),
        chunks=len(parsed.chunks),
        ocr_pages=sum(page.extraction_method == "OCR" for page in parsed.pages),
        warning_code=parsed.warning_code,
    )
    return True


def _eligible_chunk_statement(now: datetime) -> Select[tuple[DocumentChunk]]:
    return (
        select(DocumentChunk)
        .join(DocumentParseJob, DocumentParseJob.id == DocumentChunk.parse_job_id)
        .join(Asset, Asset.id == DocumentChunk.asset_id)
        .where(
            DocumentParseJob.status == "COMPLETED",
            Asset.deleted_at.is_(None),
            DocumentChunk.embedding_status.in_(("PENDING", "FAILED", "WAITING_CONFIGURATION")),
            DocumentChunk.embedding_next_run_at.is_not(None),
            DocumentChunk.embedding_next_run_at <= now,
        )
        .order_by(DocumentChunk.embedding_next_run_at, DocumentChunk.created_at, DocumentChunk.id)
        .limit(DOCUMENT_EMBEDDING_BATCH_SIZE)
        .with_for_update(skip_locked=True)
    )


def mark_document_chunks_waiting_for_configuration(
    engine: Engine,
    now: datetime,
) -> bool:
    with Session(engine) as database, database.begin():
        chunks = database.scalars(_eligible_chunk_statement(now)).all()
        if not chunks:
            return False
        for chunk in chunks:
            chunk.embedding_status = "WAITING_CONFIGURATION"
            chunk.embedding_next_run_at = now + timedelta(seconds=WAITING_CONFIGURATION_SECONDS)
            chunk.embedding_last_error_code = "embedding_not_configured"
        return True


def claim_document_chunk_batch(
    engine: Engine,
    now: datetime,
) -> ClaimedDocumentChunkBatch | None:
    with Session(engine) as database, database.begin():
        chunks = database.scalars(_eligible_chunk_statement(now)).all()
        if not chunks:
            return None
        for chunk in chunks:
            chunk.embedding_status = "RUNNING"
            chunk.embedding_attempts += 1
            chunk.embedding_next_run_at = None
            chunk.embedding_last_error_code = None
        return ClaimedDocumentChunkBatch(
            chunk_ids=tuple(chunk.id for chunk in chunks),
            texts=tuple(chunk.text for chunk in chunks),
            attempts=tuple(chunk.embedding_attempts for chunk in chunks),
        )


def complete_document_chunk_batch(
    engine: Engine,
    claimed: ClaimedDocumentChunkBatch,
    *,
    vectors: list[list[float]],
    model: str,
    usage_tokens: int,
) -> None:
    with Session(engine) as database, database.begin():
        chunks = {
            chunk.id: chunk
            for chunk in database.scalars(
                select(DocumentChunk).where(DocumentChunk.id.in_(claimed.chunk_ids))
            ).all()
        }
        per_chunk_usage = usage_tokens // max(len(claimed.chunk_ids), 1)
        for chunk_id, vector in zip(claimed.chunk_ids, vectors, strict=True):
            chunk = chunks.get(chunk_id)
            if chunk is None:
                continue
            asset = database.get(Asset, chunk.asset_id)
            job = database.get(DocumentParseJob, chunk.parse_job_id)
            if (
                asset is None
                or asset.deleted_at is not None
                or job is None
                or job.status != "COMPLETED"
            ):
                database.delete(chunk)
                continue
            chunk.embedding_status = "COMPLETED"
            chunk.embedding_model = model
            chunk.embedding_dimensions = len(vector)
            chunk.embedding = vector
            chunk.embedding_usage_tokens = per_chunk_usage
            chunk.embedding_next_run_at = None
            chunk.embedding_last_error_code = None


def fail_document_chunk_batch(
    engine: Engine,
    claimed: ClaimedDocumentChunkBatch,
    error: AIProviderError,
    settings: Settings,
    now: datetime,
) -> None:
    with Session(engine) as database, database.begin():
        chunks = database.scalars(
            select(DocumentChunk).where(DocumentChunk.id.in_(claimed.chunk_ids))
        ).all()
        attempts = dict(zip(claimed.chunk_ids, claimed.attempts, strict=True))
        for chunk in chunks:
            chunk.embedding_status = "FAILED"
            chunk.embedding = None
            chunk.embedding_model = None
            chunk.embedding_dimensions = None
            chunk.embedding_last_error_code = error.code
            attempt = attempts[chunk.id]
            if error.retryable and attempt < settings.ai_embedding_max_attempts:
                delay = min(
                    settings.ai_job_retry_base_seconds * (2 ** (attempt - 1)),
                    MAX_RETRY_DELAY_SECONDS,
                )
                chunk.embedding_next_run_at = now + timedelta(seconds=delay)
            else:
                chunk.embedding_next_run_at = None


def process_next_document_embedding_batch(
    engine: Engine,
    settings: Settings,
    embedding_model: EmbeddingModelPort | None,
    *,
    now: datetime | None = None,
) -> bool:
    current_time = now or datetime.now(UTC)
    if embedding_model is None:
        return mark_document_chunks_waiting_for_configuration(engine, current_time)
    claimed = claim_document_chunk_batch(engine, current_time)
    if claimed is None:
        return False
    logger = structlog.get_logger("memora.worker.document_embedding")
    try:
        batch = embedding_model.embed(list(claimed.texts))
        if len(batch.vectors) != len(claimed.chunk_ids):
            raise AIProviderError("invalid_provider_response", retryable=True)
    except AIProviderError as error:
        fail_document_chunk_batch(engine, claimed, error, settings, current_time)
        logger.warning(
            "document_embedding.failed",
            chunk_count=len(claimed.chunk_ids),
            error_code=error.code,
            retryable=error.retryable,
        )
        return True
    complete_document_chunk_batch(
        engine,
        claimed,
        vectors=batch.vectors,
        model=batch.model,
        usage_tokens=batch.usage.input_tokens,
    )
    logger.info(
        "document_embedding.completed",
        chunk_count=len(claimed.chunk_ids),
        model=batch.model,
        dimensions=len(batch.vectors[0]) if batch.vectors else 0,
        usage_tokens=batch.usage.input_tokens,
    )
    return True
