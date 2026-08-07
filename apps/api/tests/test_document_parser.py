from __future__ import annotations

from io import BytesIO

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from memora.documents.parser import (
    DocumentParseCancelled,
    DocumentParseError,
    DocumentParseLimits,
    UnavailableOcrEngine,
    parse_pdf_document,
)


class FakeOcrEngine:
    available = True

    def __init__(self, pages: dict[int, str] | None = None) -> None:
        self.pages = pages or {}
        self.calls: list[int] = []

    def extract_page(self, pdf_content: bytes, page_number: int, timeout_seconds: float) -> str:
        assert pdf_content.startswith(b"%PDF-")
        assert timeout_seconds > 0
        self.calls.append(page_number)
        return self.pages.get(page_number, "Scanned Notes\nEvidence recovered from the page image.")


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


def test_digital_pdf_preserves_page_heading_offsets_and_chunk_limits() -> None:
    body = "Research Plan\n\n" + "Evidence and roadmap. " * 90
    result = parse_pdf_document(
        pdf_bytes(body),
        limits=DocumentParseLimits(max_chunk_chars=320, chunk_overlap_chars=40),
        ocr=UnavailableOcrEngine(),
    )

    assert len(result.pages) == 1
    assert result.pages[0].extraction_method == "TEXT"
    assert result.pages[0].title == "Research Plan"
    assert result.warning_code is None
    assert len(result.chunks) > 1
    assert all(chunk.page_number == 1 for chunk in result.chunks)
    assert all(len(chunk.text) <= 320 for chunk in result.chunks)
    assert all(
        result.pages[0].text is not None
        and result.pages[0].text[chunk.char_start : chunk.char_end] == chunk.text
        for chunk in result.chunks
    )


def test_scanned_and_mixed_pdf_uses_ocr_only_for_low_text_pages() -> None:
    ocr = FakeOcrEngine({2: "Scanned Appendix\nRecovered evidence from a scanned page image."})
    result = parse_pdf_document(
        pdf_bytes("Digital Introduction\nThis page already has enough searchable text.", None),
        limits=DocumentParseLimits(),
        ocr=ocr,
    )

    assert ocr.calls == [2]
    assert [page.extraction_method for page in result.pages] == ["TEXT", "OCR"]
    assert {chunk.page_number for chunk in result.chunks} == {1, 2}
    assert result.warning_code is None


def test_missing_ocr_runtime_is_actionable_without_losing_asset_parse_result() -> None:
    result = parse_pdf_document(
        pdf_bytes(None),
        limits=DocumentParseLimits(),
        ocr=UnavailableOcrEngine(),
    )

    assert result.warning_code == "ocr_unavailable"
    assert result.pages[0].extraction_method == "OCR_UNAVAILABLE"
    assert result.pages[0].text is None
    assert result.chunks == ()


@pytest.mark.parametrize(
    ("content", "limits", "expected_code"),
    [
        (b"%PDF-not-a-real-document", DocumentParseLimits(), "invalid_pdf"),
        (pdf_bytes(None, None), DocumentParseLimits(max_pages=1), "page_limit_exceeded"),
    ],
)
def test_corrupt_and_over_limit_pdf_fail_with_stable_codes(
    content: bytes,
    limits: DocumentParseLimits,
    expected_code: str,
) -> None:
    with pytest.raises(DocumentParseError) as raised:
        parse_pdf_document(content, limits=limits, ocr=UnavailableOcrEngine())
    assert raised.value.code == expected_code
    assert raised.value.retryable is False


def test_progress_callback_can_cancel_between_pages() -> None:
    calls: list[tuple[str, int, int]] = []

    def cancel(phase: str, processed: int, total: int) -> bool:
        calls.append((phase, processed, total))
        return processed < 1

    with pytest.raises(DocumentParseCancelled):
        parse_pdf_document(
            pdf_bytes(
                "Page One\nThis page has enough text to avoid OCR processing.",
                "Page Two\nThis second page should never be completed.",
            ),
            limits=DocumentParseLimits(),
            ocr=UnavailableOcrEngine(),
            progress=cancel,
        )
    assert calls[0] == ("PARSING", 0, 2)
    assert ("PARSING", 1, 2) in calls
