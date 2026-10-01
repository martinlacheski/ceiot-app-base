"""Storage and retrieval of document chunks (PostgreSQL + pgvector, see migration 0014).

The chunk table is admin-only under Row Level Security: writes come from an
administrator/system session, and reads for the chat go through the
``rag_search`` SECURITY DEFINER function, which only ever returns chunks of
active, ready documents that match the current provider and model.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import text

from app.api.document.parsing import Chunk
from app.core.embeddings import to_vector_literal

MAX_TOP_K = 8


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    document_id: uuid.UUID
    title: str
    chunk_index: int
    page: int | None
    section: str | None
    content: str
    distance: float


INSERT_CHUNK = text(
    "INSERT INTO public.document_chunk (id, document_id, chunk_index, page, section, content, content_sha256, "
    "embedding, embedding_provider, embedding_model) VALUES (:id, :document_id, :chunk_index, :page, :section, "
    ":content, :sha, CAST(:embedding AS vector), :provider, :model)"
)
SEARCH = text(
    "SELECT document_id, title, chunk_index, page, section, content, distance "
    "FROM public.rag_search(CAST(:embedding AS vector), :provider, :model, :max_distance, :top_k, "
    "CAST(:document_id AS uuid))"
)


async def replace_chunks(
    session,
    document_id: uuid.UUID,
    chunks: Sequence[Chunk],
    vectors: Sequence[Sequence[float]],
    *,
    provider: str,
    model: str,
) -> None:
    """Swap the whole chunk set of a document in the caller's transaction (caller commits)."""
    if len(chunks) != len(vectors):
        raise ValueError("Each chunk needs exactly one vector")
    await session.execute(text("DELETE FROM public.document_chunk WHERE document_id = :id"), {"id": document_id})
    rows = [
        {
            "id": uuid.uuid4(),
            "document_id": document_id,
            "chunk_index": chunk.index,
            "page": chunk.page,
            "section": chunk.section,
            "content": chunk.content,
            "sha": hashlib.sha256(chunk.content.encode("utf-8")).hexdigest(),
            "embedding": to_vector_literal(vector),
            "provider": provider,
            "model": model,
        }
        for chunk, vector in zip(chunks, vectors)
    ]
    if rows:
        await session.execute(INSERT_CHUNK, rows)


async def search_chunks(
    session,
    vector: Sequence[float],
    *,
    provider: str,
    model: str,
    max_distance: float,
    top_k: int,
    document_id: uuid.UUID | None = None,
) -> list[RetrievedChunk]:
    result = await session.execute(
        SEARCH,
        {
            "embedding": to_vector_literal(vector),
            "provider": provider,
            "model": model,
            "max_distance": float(max_distance),
            "top_k": int(top_k),
            "document_id": str(document_id) if document_id else None,
        },
    )
    return [RetrievedChunk(*row) for row in result.all()]
