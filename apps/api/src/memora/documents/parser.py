from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from time import monotonic
from typing import Protocol

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class DocumentParseError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class DocumentParseCancelled(DocumentParseError):
    def __init__(self) -> None:
        super().__init__("cancelled", retryable=False)


class OcrEngine(Protocol):
    @property
    def available(self) -> bool: ...

    def extract_page(self, pdf_content: bytes, page_number: int, timeout_seconds: float) -> str: ...


class UnavailableOcrEngine:
    @property
    def available(self) -> bool:
        return False

    def extract_page(self, pdf_content: bytes, page_number: int, timeout_seconds: float) -> str:
        del pdf_content, page_number, timeout_seconds
        raise DocumentParseError("ocr_unavailable")


class TesseractOcrEngine:
    def __init__(self, *, language: str = "chi_sim+eng", resolution_dpi: int = 200) -> None:
        self.language = language
        self.resolution_dpi = resolution_dpi
        self._pdftoppm = shutil.which("pdftoppm")
        self._tesseract = shutil.which("tesseract")

    @property
    def available(self) -> bool:
        return self._pdftoppm is not None and self._tesseract is not None

    def extract_page(self, pdf_content: bytes, page_number: int, timeout_seconds: float) -> str:
        if not self.available or self._pdftoppm is None or self._tesseract is None:
            raise DocumentParseError("ocr_unavailable")
        try:
            with tempfile.TemporaryDirectory(prefix="memora-ocr-") as directory:
                root = Path(directory)
                source = root / "source.pdf"
                output_root = root / "page"
                source.write_bytes(pdf_content)
                render = subprocess.run(
                    [
                        self._pdftoppm,
                        "-f",
                        str(page_number),
                        "-l",
                        str(page_number),
                        "-r",
                        str(self.resolution_dpi),
                        "-png",
                        "-singlefile",
                        str(source),
                        str(output_root),
                    ],
                    capture_output=True,
                    check=False,
                    timeout=timeout_seconds,
                )
                if render.returncode != 0 or not (root / "page.png").exists():
                    raise DocumentParseError("ocr_render_failed", retryable=True)
                recognize = subprocess.run(
                    [
                        self._tesseract,
                        str(root / "page.png"),
                        "stdout",
                        "-l",
                        self.language,
                        "--psm",
                        "6",
                    ],
                    capture_output=True,
                    check=False,
                    timeout=timeout_seconds,
                )
                if recognize.returncode != 0:
                    stderr = recognize.stderr.decode("utf-8", errors="ignore").casefold()
                    if "failed loading language" in stderr or "error opening data file" in stderr:
                        raise DocumentParseError("ocr_language_unavailable")
                    raise DocumentParseError("ocr_recognition_failed", retryable=True)
                return recognize.stdout.decode("utf-8", errors="replace")
        except subprocess.TimeoutExpired as error:
            raise DocumentParseError("ocr_timeout", retryable=True) from error
        except OSError as error:
            raise DocumentParseError("ocr_runtime_failed", retryable=True) from error


@dataclass(frozen=True)
class DocumentParseLimits:
    max_pages: int = 100
    max_total_chars: int = 500_000
    max_chunk_chars: int = 1_400
    chunk_overlap_chars: int = 120
    min_text_chars_for_ocr: int = 40
    timeout_seconds: float = 120
    ocr_page_timeout_seconds: float = 30


@dataclass(frozen=True)
class ParsedDocumentPage:
    page_number: int
    extraction_method: str
    title: str | None
    text: str | None
    char_count: int
    quality_score: float


@dataclass(frozen=True)
class ParsedDocumentChunk:
    page_number: int
    heading: str | None
    text: str
    char_start: int
    char_end: int


@dataclass(frozen=True)
class ParsedDocument:
    pages: tuple[ParsedDocumentPage, ...]
    chunks: tuple[ParsedDocumentChunk, ...]
    warning_code: str | None


DocumentProgress = Callable[[str, int, int], bool]


def normalize_page_text(value: str) -> str:
    value = value.replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.splitlines()]
    normalized: list[str] = []
    blank = False
    for line in lines:
        if not line:
            if normalized and not blank:
                normalized.append("")
            blank = True
            continue
        normalized.append(line)
        blank = False
    return "\n".join(normalized).strip()


def text_quality(value: str) -> float:
    visible = [character for character in value if not character.isspace()]
    if not visible:
        return 0.0
    printable = sum(character.isprintable() and character != "\ufffd" for character in visible)
    useful = sum(character.isalnum() or "\u4e00" <= character <= "\u9fff" for character in visible)
    density = min(len(visible) / 180, 1.0)
    return round(density * (printable / len(visible)) * (0.5 + 0.5 * useful / len(visible)), 4)


def _looks_like_heading(value: str) -> bool:
    stripped = value.lstrip("# ").strip()
    if not stripped or len(stripped) > 100:
        return False
    if value.startswith("#"):
        return True
    if stripped[-1:] in {"。", ".", "，", ",", ";", "；", ":", "：", "?", "？"}:
        return False
    return len(stripped.split()) <= 12


def _page_title(text: str) -> str | None:
    for line in text.splitlines():
        candidate = line.lstrip("# ").strip()
        if candidate and len(candidate) <= 120:
            return candidate
    return None


def _split_range(
    text: str,
    start: int,
    end: int,
    limit: int,
    overlap: int,
) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    cursor = start
    while cursor < end:
        target = min(cursor + limit, end)
        if target < end:
            search_start = max(cursor + limit // 2, cursor)
            boundary = max(
                text.rfind("\n\n", search_start, target),
                text.rfind("。", search_start, target),
                text.rfind(". ", search_start, target),
            )
            if boundary >= search_start:
                target = boundary + (2 if text[boundary : boundary + 2] in {"\n\n", ". "} else 1)
        if target <= cursor:
            target = min(cursor + limit, end)
        ranges.append((cursor, target))
        if target >= end:
            break
        cursor = max(target - overlap, cursor + 1)
    return ranges


def chunk_page_text(
    text: str,
    page_number: int,
    *,
    limit: int,
    overlap: int,
) -> list[ParsedDocumentChunk]:
    if not text:
        return []
    headings: list[tuple[int, str]] = []
    for match in re.finditer(r"(?m)^(.+)$", text):
        line = match.group(1).strip()
        if _looks_like_heading(line):
            headings.append((match.start(), line.lstrip("# ").strip()[:240]))

    sections: list[tuple[int, int, str | None]] = []
    if headings:
        if headings[0][0] > 0:
            sections.append((0, headings[0][0], None))
        for index, (start, heading) in enumerate(headings):
            end = headings[index + 1][0] if index + 1 < len(headings) else len(text)
            sections.append((start, end, heading))
    else:
        sections.append((0, len(text), _page_title(text)))

    chunks: list[ParsedDocumentChunk] = []
    for start, end, section_heading in sections:
        for chunk_start, chunk_end in _split_range(text, start, end, limit, overlap):
            chunk_text = text[chunk_start:chunk_end].strip()
            if not chunk_text:
                continue
            left_trim = len(text[chunk_start:chunk_end]) - len(text[chunk_start:chunk_end].lstrip())
            absolute_start = chunk_start + left_trim
            chunks.append(
                ParsedDocumentChunk(
                    page_number=page_number,
                    heading=section_heading,
                    text=chunk_text,
                    char_start=absolute_start,
                    char_end=absolute_start + len(chunk_text),
                )
            )
    return chunks


def parse_pdf_document(
    content: bytes,
    *,
    limits: DocumentParseLimits,
    ocr: OcrEngine,
    progress: DocumentProgress | None = None,
) -> ParsedDocument:
    started_at = monotonic()

    def report(phase: str, processed: int, total: int) -> None:
        if monotonic() - started_at > limits.timeout_seconds:
            raise DocumentParseError("parse_timeout", retryable=True)
        if progress is not None and not progress(phase, processed, total):
            raise DocumentParseCancelled()

    try:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted:
            try:
                unlocked = reader.decrypt("")
            except Exception as error:  # pypdf raises provider-specific decryption errors.
                raise DocumentParseError("encrypted_pdf") from error
            if not unlocked:
                raise DocumentParseError("encrypted_pdf")
        page_count = len(reader.pages)
    except DocumentParseError:
        raise
    except (PdfReadError, ValueError, OSError) as error:
        raise DocumentParseError("invalid_pdf") from error

    if page_count < 1:
        raise DocumentParseError("empty_pdf")
    if page_count > limits.max_pages:
        raise DocumentParseError("page_limit_exceeded")

    report("PARSING", 0, page_count)
    pages: list[ParsedDocumentPage] = []
    chunks: list[ParsedDocumentChunk] = []
    total_chars = 0
    warning_codes: set[str] = set()
    for index, page in enumerate(reader.pages):
        report("PARSING", index, page_count)
        try:
            extracted = normalize_page_text(page.extract_text() or "")
        except (PdfReadError, ValueError, OSError):
            extracted = ""
            warning_codes.add("partial_text_extraction")
        quality = text_quality(extracted)
        method = "TEXT" if extracted else "EMPTY"
        visible_chars = len("".join(extracted.split()))
        needs_ocr = visible_chars < limits.min_text_chars_for_ocr or quality < 0.18
        if needs_ocr:
            if ocr.available:
                report("OCR", index, page_count)
                try:
                    ocr_text = normalize_page_text(
                        ocr.extract_page(content, index + 1, limits.ocr_page_timeout_seconds)
                    )
                    if len("".join(ocr_text.split())) > visible_chars:
                        extracted = ocr_text
                        quality = text_quality(extracted)
                        method = "OCR" if extracted else "EMPTY"
                except DocumentParseError as error:
                    if error.code in {"ocr_unavailable", "ocr_language_unavailable"}:
                        warning_codes.add(error.code)
                        method = "OCR_UNAVAILABLE" if not extracted else "TEXT"
                    else:
                        warning_codes.add("partial_ocr_failure")
            else:
                warning_codes.add("ocr_unavailable")
                method = "OCR_UNAVAILABLE" if not extracted else "TEXT"

        if total_chars + len(extracted) > limits.max_total_chars:
            raise DocumentParseError("character_limit_exceeded")
        total_chars += len(extracted)
        page_chunks = chunk_page_text(
            extracted,
            index + 1,
            limit=limits.max_chunk_chars,
            overlap=limits.chunk_overlap_chars,
        )
        chunks.extend(page_chunks)
        pages.append(
            ParsedDocumentPage(
                page_number=index + 1,
                extraction_method=method,
                title=_page_title(extracted),
                text=extracted or None,
                char_count=len(extracted),
                quality_score=quality,
            )
        )
        report("PARSING", index + 1, page_count)

    warning_code = sorted(warning_codes)[0] if warning_codes else None
    return ParsedDocument(pages=tuple(pages), chunks=tuple(chunks), warning_code=warning_code)
