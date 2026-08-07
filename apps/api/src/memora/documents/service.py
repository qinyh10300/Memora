from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select

from memora.assets.models import Asset
from memora.assets.service import get_authorized_asset
from memora.database import DatabaseSession
from memora.documents.models import (
    DocumentChunk,
    DocumentPage,
    DocumentParseJob,
    MemoryDocumentCitation,
)
from memora.documents.schemas import DocumentCitationInput
from memora.identity.dependencies import Principal
from memora.memories.models import Memory

MAX_DOCUMENT_CONTEXT_CHARS = 12_000
MAX_DOCUMENT_CONTEXT_CHUNKS = 16
MAX_MEMORY_DOCUMENT_CITATIONS = 24


@dataclass(frozen=True)
class DocumentChunkContext:
    id: UUID
    asset_id: UUID
    asset_name: str
    page_number: int
    heading: str | None
    text: str


@dataclass(frozen=True)
class DocumentAttachmentContext:
    status: str
    message: str
    chunks: tuple[DocumentChunkContext, ...]


def queue_document_parse(database: DatabaseSession, asset: Asset) -> DocumentParseJob:
    if asset.kind != "PDF":
        raise ValueError("only PDF assets can be parsed")
    job = DocumentParseJob(
        asset_id=asset.id,
        workspace_id=asset.workspace_id,
        owner_id=asset.owner_id,
        status="QUEUED",
    )
    database.add(job)
    return job


def get_document_job(database: DatabaseSession, asset_id: UUID) -> DocumentParseJob | None:
    return database.scalar(select(DocumentParseJob).where(DocumentParseJob.asset_id == asset_id))


def get_authorized_document_job(
    database: DatabaseSession,
    principal: Principal,
    asset_id: UUID,
) -> tuple[Asset, DocumentParseJob] | None:
    asset = get_authorized_asset(database, principal, asset_id)
    if asset is None or asset.kind != "PDF":
        return None
    job = get_document_job(database, asset.id)
    if job is None:
        return None
    return asset, job


def get_owned_document_job(
    database: DatabaseSession,
    principal: Principal,
    asset_id: UUID,
) -> tuple[Asset, DocumentParseJob] | None:
    row = database.execute(
        select(Asset, DocumentParseJob)
        .join(DocumentParseJob, DocumentParseJob.asset_id == Asset.id)
        .where(
            Asset.id == asset_id,
            Asset.workspace_id == principal.workspace_id,
            Asset.owner_id == principal.user_id,
            Asset.kind == "PDF",
            Asset.deleted_at.is_(None),
        )
    ).one_or_none()
    return (row[0], row[1]) if row is not None else None


def request_document_cancel(job: DocumentParseJob, now: datetime | None = None) -> None:
    requested_at = now or datetime.now(UTC)
    if job.status == "QUEUED":
        job.status = "CANCELLED"
        job.next_run_at = None
        job.cancel_requested_at = requested_at
        job.completed_at = requested_at
        return
    if job.status in {"PARSING", "OCR"}:
        job.status = "CANCEL_REQUESTED"
        job.cancel_requested_at = requested_at


def retry_document_parse(job: DocumentParseJob, now: datetime | None = None) -> None:
    if job.status not in {"FAILED", "CANCELLED"}:
        return
    job.status = "QUEUED"
    job.attempts = 0
    job.page_count = None
    job.processed_pages = 0
    job.text_page_count = 0
    job.ocr_page_count = 0
    job.chunk_count = 0
    job.next_run_at = now or datetime.now(UTC)
    job.locked_at = None
    job.cancel_requested_at = None
    job.completed_at = None
    job.error_code = None
    job.warning_code = None


def _search_terms(query: str) -> set[str]:
    normalized = query.casefold()
    words = set(re.findall(r"[a-z0-9_]{2,}|[\u4e00-\u9fff]", normalized))
    chinese = "".join(character for character in normalized if "\u4e00" <= character <= "\u9fff")
    words.update(chinese[index : index + 2] for index in range(max(0, len(chinese) - 1)))
    return words


def _chunk_relevance(chunk: DocumentChunk, terms: set[str]) -> tuple[int, int, int]:
    haystack = f"{chunk.heading or ''}\n{chunk.text}".casefold()
    score = sum(
        (3 if term in (chunk.heading or "").casefold() else 1) for term in terms if term in haystack
    )
    return (-score, chunk.page_number, chunk.ordinal)


def retrieve_document_attachment(
    database: DatabaseSession,
    principal: Principal,
    asset_id: UUID,
    query: str,
) -> DocumentAttachmentContext:
    authorized = get_authorized_document_job(database, principal, asset_id)
    if authorized is None:
        return DocumentAttachmentContext(
            status="NOT_FOUND",
            message="附件不存在或当前账号无权读取。",
            chunks=(),
        )
    asset, job = authorized
    if job.status != "COMPLETED":
        message = {
            "QUEUED": "PDF 正在排队解析，请稍后重试。",
            "PARSING": "PDF 正在提取文本，请稍后重试。",
            "OCR": "PDF 正在识别扫描页，请稍后重试。",
            "FAILED": "PDF 解析失败，请在附件上重试。",
            "CANCEL_REQUESTED": "PDF 解析正在取消。",
            "CANCELLED": "PDF 解析已取消。",
        }.get(job.status, "PDF 暂时不可读取。")
        return DocumentAttachmentContext(status=job.status, message=message, chunks=())

    chunks = list(
        database.scalars(
            select(DocumentChunk)
            .where(
                DocumentChunk.parse_job_id == job.id,
                DocumentChunk.asset_id == asset.id,
                DocumentChunk.workspace_id == principal.workspace_id,
            )
            .order_by(DocumentChunk.page_number, DocumentChunk.ordinal)
        ).all()
    )
    if not chunks:
        return DocumentAttachmentContext(
            status="NO_TEXT",
            message=(
                "PDF 没有可用文本；服务器缺少 OCR 能力。"
                if job.warning_code in {"ocr_unavailable", "ocr_language_unavailable"}
                else "PDF 没有提取到可用文本。"
            ),
            chunks=(),
        )

    terms = _search_terms(query)
    if terms:
        chunks.sort(key=lambda chunk: _chunk_relevance(chunk, terms))
    selected: list[DocumentChunkContext] = []
    total_chars = 0
    for chunk in chunks:
        if len(selected) >= MAX_DOCUMENT_CONTEXT_CHUNKS:
            break
        remaining = MAX_DOCUMENT_CONTEXT_CHARS - total_chars
        if remaining <= 0:
            break
        text = chunk.text[:remaining]
        if not text:
            continue
        selected.append(
            DocumentChunkContext(
                id=chunk.id,
                asset_id=asset.id,
                asset_name=asset.name,
                page_number=chunk.page_number,
                heading=chunk.heading,
                text=text,
            )
        )
        total_chars += len(text)
    return DocumentAttachmentContext(
        status="AVAILABLE",
        message=f"已读取 {len(selected)} 个带页码的文档片段。",
        chunks=tuple(selected),
    )


def persist_memory_document_citations(
    database: DatabaseSession,
    principal: Principal,
    memory: Memory,
    inputs: list[DocumentCitationInput],
) -> list[MemoryDocumentCitation]:
    ordered_ids = list(dict.fromkeys(item.chunk_id for item in inputs))
    if len(ordered_ids) > MAX_MEMORY_DOCUMENT_CITATIONS:
        raise ValueError("document_citation_limit_exceeded")
    if not ordered_ids:
        return []

    chunks = {
        chunk.id: chunk
        for chunk in database.scalars(
            select(DocumentChunk).where(
                DocumentChunk.id.in_(ordered_ids),
                DocumentChunk.workspace_id == principal.workspace_id,
            )
        ).all()
    }
    if set(chunks) != set(ordered_ids):
        raise ValueError("document_citation_not_found")

    authorized_assets: dict[UUID, Asset] = {}
    for chunk in chunks.values():
        if chunk.asset_id in authorized_assets:
            continue
        asset = get_authorized_asset(database, principal, chunk.asset_id)
        if asset is None or asset.kind != "PDF":
            raise ValueError("document_citation_not_found")
        authorized_assets[asset.id] = asset

    citations: list[MemoryDocumentCitation] = []
    for ordinal, chunk_id in enumerate(ordered_ids):
        chunk = chunks[chunk_id]
        citation = MemoryDocumentCitation(
            memory_id=memory.id,
            asset_id=chunk.asset_id,
            chunk_id=chunk.id,
            page_number=chunk.page_number,
            heading=chunk.heading,
            excerpt=chunk.text[:600],
            ordinal=ordinal,
        )
        database.add(citation)
        citations.append(citation)
    return citations


def copy_memory_document_citations(
    database: DatabaseSession,
    source_memory_id: UUID,
    target_memory: Memory,
) -> list[MemoryDocumentCitation]:
    source = database.scalars(
        select(MemoryDocumentCitation)
        .where(MemoryDocumentCitation.memory_id == source_memory_id)
        .order_by(MemoryDocumentCitation.ordinal)
    ).all()
    copied: list[MemoryDocumentCitation] = []
    for citation in source:
        item = MemoryDocumentCitation(
            memory_id=target_memory.id,
            asset_id=citation.asset_id,
            chunk_id=citation.chunk_id,
            page_number=citation.page_number,
            heading=citation.heading,
            excerpt=citation.excerpt,
            ordinal=citation.ordinal,
        )
        database.add(item)
        copied.append(item)
    return copied


def list_memory_document_citations(
    database: DatabaseSession,
    memory_id: UUID,
) -> list[tuple[MemoryDocumentCitation, Asset]]:
    return list(
        database.execute(
            select(MemoryDocumentCitation, Asset)
            .join(Asset, Asset.id == MemoryDocumentCitation.asset_id)
            .where(
                MemoryDocumentCitation.memory_id == memory_id,
                Asset.deleted_at.is_(None),
            )
            .order_by(MemoryDocumentCitation.ordinal)
        )
        .tuples()
        .all()
    )


def delete_document_derivatives(database: DatabaseSession, asset_id: UUID) -> None:
    database.execute(
        delete(MemoryDocumentCitation).where(MemoryDocumentCitation.asset_id == asset_id)
    )
    database.execute(delete(DocumentPage).where(DocumentPage.asset_id == asset_id))
    database.execute(delete(DocumentChunk).where(DocumentChunk.asset_id == asset_id))
    database.execute(delete(DocumentParseJob).where(DocumentParseJob.asset_id == asset_id))


def delete_memory_document_citations(database: DatabaseSession, memory_id: UUID) -> None:
    database.execute(
        delete(MemoryDocumentCitation).where(MemoryDocumentCitation.memory_id == memory_id)
    )
