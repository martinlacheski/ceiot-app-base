"""API projections for admin documents."""

import uuid
from datetime import datetime

from pydantic import computed_field, model_validator

from app.api.document.constants import MAX_TITLE_LENGTH
from app.core.embeddings import canonical_model, current_identity
from app.core.utils import CamelModel


class DocumentRead(CamelModel):
    id: uuid.UUID
    title: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    uploaded_by: uuid.UUID | None
    is_active: bool
    ingestion_status: str
    ingested_at: datetime | None
    error: str | None
    chunk_count: int = 0
    embedding_provider: str | None = None
    embedding_model: str | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def needs_reindex(self) -> bool:
        """Indexed with a provider/model other than the configured ones: retrieval would skip it."""
        if self.ingestion_status != "ready":
            return False
        stored = (self.embedding_provider, canonical_model(self.embedding_model or ""))
        return stored != current_identity()


class IngestionQueued(CamelModel):
    queued: int
    document_ids: list[uuid.UUID]


class DocumentPatch(CamelModel):
    """Only the title and the RAG-inclusion flag are editable."""

    title: str | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self):
        for field in ("title", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if self.title is not None:
            self.title = self.title.strip()
            if not 1 <= len(self.title) <= MAX_TITLE_LENGTH:
                raise ValueError(f"title must have between 1 and {MAX_TITLE_LENGTH} characters")
        return self
