from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from io import BytesIO
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from memora.ai.ports import ChatMessage, ChatResult, EmbeddingBatch, ModelUsage
from memora.database import Base
from memora.documents.models import (
    DocumentChunk,
    DocumentPage,
    DocumentParseJob,
    MemoryDocumentCitation,
)
from memora.documents.parser import UnavailableOcrEngine
from memora.documents.worker import (
    process_next_document_embedding_batch,
    process_next_document_job,
)
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


class FakeOcrEngine:
    available = True

    def extract_page(self, pdf_content: bytes, page_number: int, timeout_seconds: float) -> str:
        assert pdf_content.startswith(b"%PDF-")
        assert page_number > 0 and timeout_seconds > 0
        return "Scanned Research Notes\nEvidence recovered from the page image for citation."


class FakeDocumentEmbeddingModel:
    model_id = "document-embedding-v1"

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        return EmbeddingBatch(
            vectors=[[0.2, 0.8] for _text in texts],
            model=self.model_id,
            usage=ModelUsage(input_tokens=len(texts) * 3),
        )


class DocumentDraftModel:
    model_id = "document-draft-model"

    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []

    def complete(self, messages: list[ChatMessage]) -> ChatResult:
        self.messages = messages
        context = json.loads(messages[-1].content)
        chunk = context["ATTACHMENT_CONTEXT_JSON"][0]["chunks"][0]
        return ChatResult(
            content=json.dumps(
                {
                    "assistant_message": "已按页码整理文档内容。",
                    "markdown": "# Research summary\n\nEvidence from the uploaded document.",
                    "draft_changed": True,
                    "used_memory_ids": [],
                    "used_web_source_urls": [],
                    "used_document_chunk_ids": [chunk["chunk_id"]],
                }
            ),
            model=self.model_id,
            usage=ModelUsage(input_tokens=42, output_tokens=18),
        )


def pdf_bytes(*page_texts: str | None) -> bytes:
    writer = PdfWriter()
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    font_ref = writer._add_object(font)
    for text in page_texts:
        page = writer.add_blank_page(width=612, height=792)
        if text is None:
            continue
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands = ["BT /F1 14 Tf 72 720 Td"]
        for index, line in enumerate(escaped.splitlines()):
            if index:
                commands.append("0 -24 Td")
            commands.append(f"({line}) Tj")
        commands.append("ET")
        stream = DecodedStreamObject()
        stream.set_data(" ".join(commands).encode("latin-1"))
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})}
        )
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


@pytest.fixture
def document_client() -> Iterator[tuple[TestClient, Settings]]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="document-test-secret-not-for-production",
        document_parse_max_pages=4,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client, settings


def login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def upload_pdf(
    client: TestClient,
    headers: dict[str, str],
    content: bytes,
    name: str = "notes.pdf",
) -> Any:
    return client.post(
        "/assets",
        headers=headers,
        json={
            "name": name,
            "media_type": "application/pdf",
            "data": base64.b64encode(content).decode(),
        },
    )


def test_document_pipeline_retrieves_page_citations_and_rechecks_sharing(
    document_client: tuple[TestClient, Settings],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, settings = document_client
    app = cast(FastAPI, client.app)
    alex = login(client, "alex@memora.local", "memora-local-alex")
    blair = login(client, "blair@memora.local", "memora-local-blair")
    content = pdf_bytes(
        "Research Plan\nEvidence for the social world model and a concrete product roadmap."
    )

    upload = upload_pdf(client, alex, content, "research-plan.pdf")
    assert upload.status_code == 201
    asset_id = upload.json()["id"]
    assert upload.json()["document"]["status"] == "QUEUED"
    assert client.get(f"/assets/{asset_id}/document", headers=blair).status_code == 404

    assert process_next_document_job(
        app.state.engine,
        settings,
        ocr_engine=FakeOcrEngine(),
    )
    status = client.get(f"/assets/{asset_id}/document", headers=alex)
    assert status.status_code == 200
    assert status.json()["status"] == "COMPLETED"
    assert status.json()["page_count"] == 1
    assert status.json()["chunk_count"] >= 1

    with Session(app.state.engine) as database:
        chunk = database.scalar(
            select(DocumentChunk)
            .where(DocumentChunk.asset_id == UUID(asset_id))
            .order_by(DocumentChunk.ordinal)
        )
        page = database.scalar(select(DocumentPage).where(DocumentPage.asset_id == UUID(asset_id)))
    assert chunk is not None and page is not None
    assert page.page_number == 1 and page.title == "Research Plan"

    model = DocumentDraftModel()
    monkeypatch.setattr("memora.api.drafts.build_chat_model", lambda _settings, **_kwargs: model)
    chat = client.post(
        "/drafts/chat",
        headers=alex,
        json={
            "markdown": "",
            "messages": [
                {
                    "role": "USER",
                    "content": "Read this document and write a Markdown summary.",
                    "attachments": [{"asset_id": asset_id}],
                }
            ],
        },
    )
    assert chat.status_code == 200
    document_citations = chat.json()["document_citations"]
    assert document_citations[0]["chunk_id"] == str(chunk.id)
    assert document_citations[0]["page_number"] == 1
    assert base64.b64encode(content).decode() not in model.messages[-1].content

    saved = client.post(
        "/memories",
        headers=alex,
        json={
            "body": chat.json()["markdown"],
            "visibility": "PRIVATE",
            "document_citations": [{"chunk_id": str(chunk.id)}],
        },
    )
    assert saved.status_code == 201
    memory_id = saved.json()["id"]
    assert saved.json()["document_citations"][0]["page_number"] == 1
    assert client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 404

    assert client.post(f"/memories/{memory_id}/share", headers=alex).status_code == 200
    assert client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 200
    shared_memory = client.get(f"/memories/{memory_id}", headers=blair)
    assert shared_memory.status_code == 200
    assert shared_memory.json()["document_citations"][0]["asset_name"] == "research-plan.pdf"

    assert client.post(f"/memories/{memory_id}/unshare", headers=alex).status_code == 200
    assert client.get(f"/assets/{asset_id}/content", headers=blair).status_code == 404
    assert client.post(f"/memories/{memory_id}/share", headers=alex).status_code == 200

    deleted = client.delete(f"/assets/{asset_id}", headers=alex)
    assert deleted.status_code == 204
    assert client.get(f"/assets/{asset_id}/content", headers=alex).status_code == 404
    memory_after_delete = client.get(f"/memories/{memory_id}", headers=alex)
    assert memory_after_delete.status_code == 200
    assert memory_after_delete.json()["document_citations"] == []
    with Session(app.state.engine) as database:
        assert (
            database.scalar(
                select(func.count(DocumentParseJob.id)).where(
                    DocumentParseJob.asset_id == UUID(asset_id)
                )
            )
            == 0
        )
        assert (
            database.scalar(
                select(func.count(DocumentChunk.id)).where(DocumentChunk.asset_id == UUID(asset_id))
            )
            == 0
        )
        assert (
            database.scalar(
                select(func.count(MemoryDocumentCitation.id)).where(
                    MemoryDocumentCitation.asset_id == UUID(asset_id)
                )
            )
            == 0
        )


def test_document_worker_handles_ocr_embedding_cancel_retry_and_limits(
    document_client: tuple[TestClient, Settings],
) -> None:
    client, settings = document_client
    app = cast(FastAPI, client.app)
    alex = login(client, "alex@memora.local", "memora-local-alex")

    scanned = upload_pdf(client, alex, pdf_bytes(None), "scan.pdf")
    assert scanned.status_code == 201
    scanned_id = scanned.json()["id"]
    assert process_next_document_job(
        app.state.engine,
        settings,
        ocr_engine=FakeOcrEngine(),
    )
    scanned_status = client.get(f"/assets/{scanned_id}/document", headers=alex).json()
    assert scanned_status["status"] == "COMPLETED"
    assert scanned_status["ocr_page_count"] == 1
    assert scanned_status["chunk_count"] >= 1
    assert process_next_document_embedding_batch(
        app.state.engine,
        settings,
        FakeDocumentEmbeddingModel(),
    )
    with Session(app.state.engine) as database:
        embedded = database.scalars(
            select(DocumentChunk).where(DocumentChunk.asset_id == UUID(scanned_id))
        ).all()
    assert embedded and all(chunk.embedding_status == "COMPLETED" for chunk in embedded)

    no_ocr = upload_pdf(client, alex, pdf_bytes(None), "no-ocr.pdf")
    assert no_ocr.status_code == 201
    no_ocr_id = no_ocr.json()["id"]
    assert process_next_document_job(
        app.state.engine,
        settings,
        ocr_engine=UnavailableOcrEngine(),
    )
    no_ocr_status = client.get(f"/assets/{no_ocr_id}/document", headers=alex).json()
    assert no_ocr_status["status"] == "COMPLETED"
    assert no_ocr_status["warning_code"] == "ocr_unavailable"
    assert "OCR" in no_ocr_status["message"]
    assert no_ocr_status["chunk_count"] == 0

    corrupt = upload_pdf(client, alex, b"%PDF-not-a-real-document", "broken.pdf")
    assert corrupt.status_code == 201
    corrupt_id = corrupt.json()["id"]
    assert process_next_document_job(app.state.engine, settings, ocr_engine=FakeOcrEngine())
    corrupt_status = client.get(f"/assets/{corrupt_id}/document", headers=alex).json()
    assert corrupt_status["status"] == "FAILED"
    assert corrupt_status["error_code"] == "invalid_pdf"
    assert corrupt_status["can_retry"] is True
    retried = client.post(f"/assets/{corrupt_id}/document/retry", headers=alex)
    assert retried.status_code == 200 and retried.json()["status"] == "QUEUED"
    cancelled = client.post(f"/assets/{corrupt_id}/document/cancel", headers=alex)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"

    limited_settings = settings.model_copy(update={"document_parse_max_pages": 1})
    over_limit = upload_pdf(client, alex, pdf_bytes(None, None), "too-many-pages.pdf")
    assert over_limit.status_code == 201
    over_limit_id = over_limit.json()["id"]
    assert process_next_document_job(
        app.state.engine,
        limited_settings,
        ocr_engine=FakeOcrEngine(),
    )
    over_limit_status = client.get(f"/assets/{over_limit_id}/document", headers=alex).json()
    assert over_limit_status["status"] == "FAILED"
    assert over_limit_status["error_code"] == "page_limit_exceeded"
