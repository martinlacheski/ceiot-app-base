"""Document ingestion: object storage -> parse -> chunk -> embed -> pgvector.

State machine on ``document.ingestion_status``: ``pending`` -> ``processing`` ->
``ready`` | ``failed``. The transition to ``processing`` (``claim``) is a single
conditional UPDATE, so it is the per-document lock: it works across processes,
and a crashed worker's claim expires after ``STALE_AFTER``. The work itself runs
in a background task with its own system session (the request session is gone
by then). Embeddings are computed before anything is written, and the chunk swap
plus the ``ready`` mark share one transaction: a failed run never leaves a
half-indexed document that retrieval could return.

Failures store a short Spanish message (never provider bodies, keys or paths).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncContextManager, Awaitable, Callable, Sequence

from sqlalchemy import and_, or_, select, update
from starlette.concurrency import run_in_threadpool

from app.api.document import constants
from app.api.document.chunks import replace_chunks
from app.api.document.models import Document
from app.api.document.parsing import DocumentRejected, parse_and_chunk, passage_text
from app.core.embeddings import EmbeddingError, EmbeddingNotConfigured, EmbeddingUnavailable
from app.core.storage import StorageUnavailable

logger = logging.getLogger(__name__)

STALE_AFTER = timedelta(minutes=15)
SessionFactory = Callable[[], AsyncContextManager]


def _utc() -> datetime:
    return datetime.now(timezone.utc)


async def claim(session, document_id: uuid.UUID, *, now: datetime | None = None) -> bool:
    """Atomically move a document to ``processing``; False if missing or already being processed."""
    now = now or _utc()
    result = await session.execute(
        update(Document)
        .where(
            Document.id == document_id,
            or_(Document.ingestion_status != "processing", Document.updated_at < now - STALE_AFTER),
        )
        .values(ingestion_status="processing", error=None, updated_at=now)
        .returning(Document.id)
        .execution_options(synchronize_session=False)
    )
    claimed = result.first() is not None
    await session.commit()
    return claimed


async def select_for_reindex(
    session, *, provider: str, model: str, everything: bool = False
) -> Sequence[uuid.UUID]:
    """Ids of documents to (re)index: stale or unfinished ones, or every idle one with ``everything``."""
    query = select(Document.id).where(Document.ingestion_status != "processing")
    if not everything:
        query = query.where(
            or_(
                Document.ingestion_status != "ready",
                Document.embedding_provider.is_(None),
                Document.embedding_provider != provider,
                Document.embedding_model.is_(None),
                Document.embedding_model != model,
            )
        )
    return list((await session.execute(query.order_by(Document.created_at))).scalars().all())


def public_error(error: Exception) -> str:
    if isinstance(error, DocumentRejected):
        return error.reason
    if isinstance(error, EmbeddingNotConfigured):
        return "Embeddings no configurados."
    if isinstance(error, EmbeddingError):
        return "El servicio de embeddings no pudo procesar el documento."
    if isinstance(error, StorageUnavailable):
        return "Almacenamiento no disponible o archivo ausente."
    return "Error inesperado al indexar el documento."


async def _read_object(storage, key: str) -> bytes:
    limit = constants.MAX_DOCUMENT_BYTES
    buffer = bytearray()
    async for chunk in storage.stream(key):
        buffer.extend(chunk)
        if len(buffer) > limit:
            raise DocumentRejected("El archivo supera el tamaño máximo para indexar.")
    return bytes(buffer)


async def _mark_failed(session_factory: SessionFactory, document_id: uuid.UUID, message: str) -> None:
    try:
        async with session_factory() as session:
            await session.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(ingestion_status="failed", error=message[:500], updated_at=_utc())
                .execution_options(synchronize_session=False)
            )
            await session.commit()
    except Exception:
        logger.exception("Could not mark document %s as failed", document_id)


async def run_ingestion(
    document_id: uuid.UUID,
    *,
    session_factory: SessionFactory,
    storage,
    embedder,
    write_chunks: Callable[..., Awaitable[None]] = replace_chunks,
) -> None:
    """Index one claimed document. Never raises: every outcome is recorded on the row."""
    try:
        async with session_factory() as session:
            document = await session.get(Document, document_id)
            if document is None:
                return  # deleted while queued
            storage_key, extension = document.storage_key, document.filename.rpartition(".")[2].lower()
        data = await _read_object(storage, storage_key)
        chunks = await run_in_threadpool(parse_and_chunk, data, extension)
        vectors = await embedder.embed([passage_text(chunk) for chunk in chunks])
        if len(vectors) != len(chunks):
            raise EmbeddingUnavailable("Respuesta inválida del servicio de embeddings")
        async with session_factory() as session:
            await write_chunks(session, document_id, chunks, vectors, provider=embedder.provider, model=embedder.model)
            result = await session.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(
                    ingestion_status="ready",
                    error=None,
                    chunk_count=len(chunks),
                    embedding_provider=embedder.provider,
                    embedding_model=embedder.model,
                    ingested_at=_utc(),
                    updated_at=_utc(),
                )
                .returning(Document.id)
                .execution_options(synchronize_session=False)
            )
            if result.first() is None:  # deleted meanwhile
                await session.rollback()
                return
            await session.commit()
    except Exception as error:
        if not isinstance(error, (DocumentRejected, EmbeddingError, StorageUnavailable)):
            logger.exception("Unexpected failure ingesting document %s", document_id)
        else:
            logger.warning("Ingestion of document %s failed: %s", document_id, type(error).__name__)
        await _mark_failed(session_factory, document_id, public_error(error))


async def run_batch(document_ids: Sequence[uuid.UUID], **dependencies) -> None:
    """Sequential on purpose: re-embedding a corpus must not stampede the provider."""
    for document_id in document_ids:
        await run_ingestion(document_id, **dependencies)
