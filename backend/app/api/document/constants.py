"""Allowed document types and limits (the future RAG corpus)."""

from typing import Final

# Read at call time (tests patch it): the API cap for one uploaded file.
MAX_DOCUMENT_BYTES: int = 20 * 1024 * 1024

MAX_TITLE_LENGTH: Final = 255
MAX_FILENAME_LENGTH: Final = 255

# extension (lowercase, no dot) -> canonical content type
CONTENT_TYPES: Final[dict[str, str]] = {
    "pdf": "application/pdf",
    "txt": "text/plain",
    "md": "text/markdown",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

INGESTION_STATUSES: Final = ("pending", "processing", "ready", "failed")
