"""Text extraction and chunking of admin documents (PDF, TXT, MD, DOCX).

Pure and CPU-bound: callers run it in a worker thread. Every chunk keeps its
provenance (page for PDFs, section from headings for Markdown/DOCX) so answers
can cite it. Rejections carry a Spanish reason that is safe to show to the
administrator; internal parser errors are never leaked.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass

CHUNK_CHARS = 1200
CHUNK_OVERLAP_CHARS = 150
# Read at call time (tests patch them).
MAX_CHUNKS = 3000
MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
NO_TEXT = "El documento no contiene texto extraíble; no se aplica OCR."

_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")


class DocumentRejected(ValueError):
    """Expected rejection whose reason is safe to show to a Spanish-speaking administrator."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True, slots=True)
class Segment:
    text: str
    page: int | None
    section: str | None


@dataclass(frozen=True, slots=True)
class Chunk:
    index: int
    page: int | None
    section: str | None
    content: str


def passage_text(chunk: Chunk) -> str:
    """Text sent to the embedding model (bge-m3 takes no query/passage prefixes)."""
    return f"{chunk.section}. {chunk.content}" if chunk.section else chunk.content


# -- extraction ---------------------------------------------------------


def _meaningful(text: str) -> bool:
    return sum(character.isalnum() for character in text) >= 10


def _pdf_segments(data: bytes) -> list[Segment]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise DocumentRejected("No se aceptan PDFs cifrados.")
        pages = list(reader.pages)
    except DocumentRejected:
        raise
    except Exception:
        raise DocumentRejected("No se pudo interpretar el PDF.") from None
    segments = []
    for number, page in enumerate(pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            raise DocumentRejected("No se pudo extraer el texto del PDF.") from None
        segments.append(Segment(text, number, None))  # the page is the provenance
    return segments


def _decode_utf8(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise DocumentRejected("El archivo de texto debe estar codificado en UTF-8.") from None


def _text_segments(data: bytes) -> list[Segment]:
    return [Segment(_decode_utf8(data), None, None)]


def _markdown_segments(data: bytes) -> list[Segment]:
    segments: list[Segment] = []
    section: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            segments.append(Segment("\n".join(buffer), None, section))
            buffer.clear()

    for line in _decode_utf8(data).splitlines():
        match = _HEADING.match(line)
        if match:
            flush()
            section = match.group(1).strip()
        else:
            buffer.append(line)
    flush()
    return segments


def _docx_segments(data: bytes) -> list[Segment]:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(info.file_size for info in archive.infolist()) > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise DocumentRejected("El documento DOCX es demasiado grande una vez descomprimido.")
        document = Document(io.BytesIO(data))
        segments: list[Segment] = []
        section: str | None = None
        buffer: list[str] = []

        def flush() -> None:
            if buffer:
                segments.append(Segment("\n".join(buffer), None, section))
                buffer.clear()

        for block in document.iter_inner_content():
            if isinstance(block, Paragraph):
                text = block.text.strip()
                style = (block.style.name if block.style is not None else "") or ""
                if text and re.match(r"^(Heading|Título|Title)\b", style):
                    flush()
                    section = text
                elif text:
                    buffer.append(text)
            elif isinstance(block, Table):
                for row in block.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        buffer.append(" | ".join(cells))
        flush()
        return segments
    except DocumentRejected:
        raise
    except Exception:
        raise DocumentRejected("No se pudo interpretar el documento DOCX.") from None


_EXTRACTORS = {"pdf": _pdf_segments, "txt": _text_segments, "md": _markdown_segments, "docx": _docx_segments}


def extract_segments(data: bytes, extension: str) -> list[Segment]:
    try:
        extractor = _EXTRACTORS[extension.lower().lstrip(".")]
    except KeyError:
        raise DocumentRejected("Tipo de archivo no admitido para indexar.") from None
    return extractor(data)


# -- chunking -----------------------------------------------------------


def _word_units(text: str, limit: int) -> list[str]:
    units: list[str] = []
    for word in text.split():
        if len(word) <= limit:
            units.append(word)
        else:
            units.extend(word[offset : offset + limit] for offset in range(0, len(word), limit))
    return units


def _fragments(text: str, limit: int, overlap: int) -> list[str]:
    words = _word_units(text, limit)
    fragments: list[str] = []
    start = 0
    while start < len(words):
        end, length = start, 0
        while end < len(words):
            proposed = length + (1 if end > start else 0) + len(words[end])
            if proposed > limit:
                break
            length, end = proposed, end + 1
        end = max(end, start + 1)
        fragments.append(" ".join(words[start:end]))
        if end == len(words):
            break
        next_start, shared = end, 0
        while next_start > start + 1 and shared < overlap:
            next_start -= 1
            shared += len(words[next_start]) + (1 if next_start < end - 1 else 0)
        start = next_start
    return fragments


def chunk_segments(
    segments: list[Segment], *, max_chars: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP_CHARS
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for segment in segments:
        text = " ".join(segment.text.split())
        if not text:
            continue
        for content in _fragments(text, max_chars, overlap):
            chunks.append(Chunk(len(chunks), segment.page, segment.section, content))
            if len(chunks) > MAX_CHUNKS:
                raise DocumentRejected("El documento es demasiado extenso para indexarlo.")
    return chunks


def parse_and_chunk(data: bytes, extension: str) -> list[Chunk]:
    segments = extract_segments(data, extension)
    if not _meaningful(" ".join(segment.text for segment in segments)):
        raise DocumentRejected(NO_TEXT)
    chunks = chunk_segments(segments)
    if not chunks:
        raise DocumentRejected(NO_TEXT)
    return chunks
