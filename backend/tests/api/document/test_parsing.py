"""Parsing and chunking of admin documents: provenance, rejections, bounded work."""

import io
import zipfile

import pytest
from docx import Document as DocxDocument
from pypdf import PdfWriter

from app.api.document import parsing
from app.api.document.parsing import DocumentRejected, Segment, chunk_segments, parse_and_chunk


def make_pdf(pages: list[str]) -> bytes:
    """A minimal valid text PDF (Helvetica), one content stream per page."""
    objects: list[bytes] = []
    n = len(pages)
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    font_id = 3 + 2 * n
    for i, text in enumerate(pages):
        content_id = 4 + 2 * i
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode()
        )
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 50 700 Td ({safe}) Tj ET".encode("latin-1")
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def make_docx(paragraphs: list[tuple[str, str | None]]) -> bytes:
    document = DocxDocument()
    for text, style in paragraphs:
        if style and style.startswith("Heading"):
            document.add_heading(text, level=int(style.split()[1]))
        else:
            document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_pdf_chunks_keep_page_provenance():
    data = make_pdf(["La bomba de agua debe revisarse cada seis meses.", "El sensor de temperatura se calibra una vez al año."])
    chunks = parse_and_chunk(data, "pdf")
    assert [c.page for c in chunks] == [1, 2]
    assert chunks[0].section is None and "bomba de agua" in chunks[0].content
    assert [c.index for c in chunks] == [0, 1]


def test_pdf_without_extractable_text_is_rejected():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(DocumentRejected, match="texto"):
        parse_and_chunk(buffer.getvalue(), "pdf")


def test_encrypted_pdf_is_rejected():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt("secret")
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(DocumentRejected, match="cifrado"):
        parse_and_chunk(buffer.getvalue(), "pdf")


def test_corrupt_pdf_is_rejected_with_a_safe_message():
    with pytest.raises(DocumentRejected) as caught:
        parse_and_chunk(b"%PDF-1.4 this is not really a pdf", "pdf")
    assert "Traceback" not in caught.value.reason


def test_plain_text_has_no_page_and_no_section():
    chunks = parse_and_chunk("Manual de operación del equipo número uno.\n\nSegundo párrafo.".encode(), "txt")
    assert len(chunks) == 1 and chunks[0].page is None and chunks[0].section is None


def test_text_must_be_utf8_and_not_empty():
    with pytest.raises(DocumentRejected, match="UTF-8"):
        parse_and_chunk("canción".encode("latin-1"), "txt")
    with pytest.raises(DocumentRejected, match="texto"):
        parse_and_chunk(b"   \n\t  ", "txt")


def test_utf8_bom_is_ignored():
    chunks = parse_and_chunk(b"\xef\xbb\xbfContenido del manual de usuario.", "txt")
    assert chunks[0].content.startswith("Contenido")


def test_markdown_sections_come_from_headings():
    md = (
        "Introducción sin título previo al primer encabezado del manual.\n\n"
        "# Instalación\nColocar el equipo lejos de la humedad y de la luz solar.\n\n"
        "## Mantenimiento\nLimpiar el filtro cada tres meses con agua tibia.\n"
    )
    chunks = parse_and_chunk(md.encode(), "md")
    assert [c.section for c in chunks] == [None, "Instalación", "Mantenimiento"]
    assert all(c.page is None for c in chunks)
    assert "filtro" in chunks[2].content and "#" not in chunks[2].content


def test_docx_paragraphs_and_headings():
    data = make_docx(
        [("Guía rápida", "Heading 1"), ("Encender el equipo con el botón verde.", None),
         ("Alarmas", "Heading 2"), ("La alarma roja indica falta de agua en el tanque.", None)]
    )
    chunks = parse_and_chunk(data, "docx")
    assert [c.section for c in chunks] == ["Guía rápida", "Alarmas"]
    assert all(c.page is None for c in chunks)
    assert "botón verde" in chunks[0].content


def test_docx_that_is_not_a_zip_is_rejected():
    with pytest.raises(DocumentRejected):
        parse_and_chunk(b"PK\x03\x04 garbage", "docx")


def test_docx_decompression_bomb_is_rejected(monkeypatch):
    monkeypatch.setattr(parsing, "MAX_DOCX_UNCOMPRESSED_BYTES", 1000)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "a" * 50_000)
    with pytest.raises(DocumentRejected, match="demasiado"):
        parse_and_chunk(buffer.getvalue(), "docx")


def test_unknown_extension_is_rejected():
    with pytest.raises(DocumentRejected):
        parse_and_chunk(b"x", "exe")


def test_chunks_respect_size_and_overlap_and_never_split_words():
    words = [f"palabra{i}" for i in range(600)]
    chunks = chunk_segments([Segment(" ".join(words), page=3, section="Página 3")], max_chars=1200, overlap=150)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk.content) <= 1200 and chunk.page == 3
        assert all(word in words for word in chunk.content.split())
    # consecutive chunks share words (overlap) but stay under the overlap budget plus one word
    first, second = chunks[0].content.split(), chunks[1].content.split()
    shared = [w for w in first[-30:] if w in second[:30]]
    assert shared
    covered = {w for chunk in chunks for w in chunk.content.split()}
    assert covered == set(words)


def test_a_single_huge_token_is_split_not_dropped():
    chunks = chunk_segments([Segment("x" * 3000, page=None, section=None)], max_chars=1200, overlap=150)
    assert [len(c.content) for c in chunks] == [1200, 1200, 600]


def test_too_many_chunks_is_rejected(monkeypatch):
    monkeypatch.setattr(parsing, "MAX_CHUNKS", 3)
    with pytest.raises(DocumentRejected, match="extenso"):
        chunk_segments([Segment(" ".join(["palabra"] * 2000), page=1, section=None)], max_chars=100, overlap=10)


def test_passage_text_prefixes_the_section_only_when_present():
    with_section = parsing.Chunk(index=0, page=2, section="Alarmas", content="Texto")
    without = parsing.Chunk(index=1, page=None, section=None, content="Texto")
    assert parsing.passage_text(with_section) == "Alarmas. Texto"
    assert parsing.passage_text(without) == "Texto"
