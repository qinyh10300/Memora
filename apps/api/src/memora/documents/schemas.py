from __future__ import annotations

from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, Field

from memora.assets.models import Asset
from memora.documents.models import DocumentParseJob, MemoryDocumentCitation

DocumentParseStatus = Literal[
    "QUEUED",
    "PARSING",
    "OCR",
    "COMPLETED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
]


class DocumentStatusResponse(BaseModel):
    asset_id: UUID
    status: DocumentParseStatus
    page_count: int | None
    processed_pages: int
    text_page_count: int
    ocr_page_count: int
    chunk_count: int
    error_code: str | None
    warning_code: str | None
    message: str
    can_cancel: bool
    can_retry: bool
    created_at: datetime
    updated_at: datetime


class DocumentCitationInput(BaseModel):
    chunk_id: UUID


class DraftDocumentCitationResponse(BaseModel):
    asset_id: UUID
    asset_name: str
    chunk_id: UUID
    page_number: int
    heading: str | None
    excerpt: str = Field(max_length=600)
    content_url: str


class DocumentCitationResponse(BaseModel):
    id: UUID
    asset_id: UUID
    asset_name: str
    chunk_id: UUID | None
    page_number: int
    heading: str | None
    excerpt: str = Field(max_length=600)
    content_url: str


_STATUS_MESSAGES = {
    "QUEUED": "PDF 已上传，正在等待解析。",
    "PARSING": "正在提取 PDF 文本并按页面和章节整理。",
    "OCR": "正在识别文本较少的扫描页面。",
    "COMPLETED": "PDF 已解析，可以交给 AI 阅读。",
    "FAILED": "PDF 解析失败，可以重试或更换文件。",
    "CANCEL_REQUESTED": "正在停止 PDF 解析。",
    "CANCELLED": "PDF 解析已取消，可以重新开始。",
}

_ERROR_MESSAGES = {
    "invalid_pdf": "PDF 文件损坏或结构无效，请重新导出后上传。",
    "encrypted_pdf": "暂不支持需要密码的 PDF，请先移除密码。",
    "empty_pdf": "PDF 没有可读取的页面。",
    "page_limit_exceeded": "PDF 页数超过处理上限，请拆分后上传。",
    "character_limit_exceeded": "PDF 文本量超过处理上限，请拆分后上传。",
    "parse_timeout": "PDF 处理超时，请拆分文件后重试。",
    "ocr_runtime_failed": "OCR 运行时暂时不可用，请稍后重试。",
    "ocr_render_failed": "扫描页渲染失败，请重新导出 PDF 后重试。",
    "ocr_recognition_failed": "扫描页文字识别失败，请稍后重试。",
    "ocr_timeout": "扫描页文字识别超时，请拆分文件后重试。",
}

_WARNING_MESSAGES = {
    "ocr_unavailable": "解析已完成，但部分扫描页没有文字；服务器未安装 OCR 运行时。",
    "ocr_language_unavailable": "解析已完成，但 OCR 缺少中文或英文语言包。",
    "partial_ocr_failure": "解析已完成，但部分扫描页文字识别失败。",
    "partial_text_extraction": "解析已完成，但部分页面无法直接提取文字。",
}


def document_status_for(job: DocumentParseJob, *, is_owner: bool) -> DocumentStatusResponse:
    status = cast(DocumentParseStatus, job.status)
    message = _ERROR_MESSAGES.get(job.error_code or "") or _WARNING_MESSAGES.get(
        job.warning_code or ""
    )
    if message is None:
        message = _STATUS_MESSAGES.get(job.status, "PDF 状态未知，请刷新后重试。")
    return DocumentStatusResponse(
        asset_id=job.asset_id,
        status=status,
        page_count=job.page_count,
        processed_pages=job.processed_pages,
        text_page_count=job.text_page_count,
        ocr_page_count=job.ocr_page_count,
        chunk_count=job.chunk_count,
        error_code=job.error_code,
        warning_code=job.warning_code,
        message=message,
        can_cancel=is_owner and job.status in {"QUEUED", "PARSING", "OCR"},
        can_retry=is_owner and job.status in {"FAILED", "CANCELLED"},
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def document_citation_response_for(
    citation: MemoryDocumentCitation,
    asset: Asset,
) -> DocumentCitationResponse:
    return DocumentCitationResponse(
        id=citation.id,
        asset_id=asset.id,
        asset_name=asset.name,
        chunk_id=citation.chunk_id,
        page_number=citation.page_number,
        heading=citation.heading,
        excerpt=citation.excerpt[:600],
        content_url=f"/api/assets/{asset.id}/content#page={citation.page_number}",
    )
