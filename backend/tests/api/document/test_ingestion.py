"""Ingestion state machine with fakes: claim, processing -> ready/failed, safe errors, reindex selection."""

import hashlib
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.document import ingestion
from app.api.document.ingestion import claim, run_ingestion, select_for_reindex
from app.api.document.models import Document
from app.core.embeddings import EMBEDDING_DIMENSIONS, EmbeddingNotConfigured, EmbeddingUnavailable
from app.core.storage import StorageUnavailable

pytestmark = pytest.mark.asyncio

TEXT = ("La bomba de agua debe revisarse cada seis meses. " * 4).encode()


class FakeStorage:
    def __init__(self, objects=None, fail=False):
        self.objects = objects or {}
        self.fail = fail

    async def stream(self, key):
        if self.fail:
            raise StorageUnavailable("down")
        if key not in self.objects:
            raise StorageUnavailable("missing")
        data = self.objects[key]
        for start in range(0, len(data), 16):
            yield data[start : start + 16]


class FakeEmbedder:
    provider = "local"
    model = "baai/bge-m3"

    def __init__(self, error=None):
        self.error = error
        self.calls: list[list[str]] = []

    async def embed(self, texts):
        self.calls.append(list(texts))
        if self.error:
            raise self.error
        return [[1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1) for _ in texts]


class FakeWriter:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    async def __call__(self, session, document_id, chunks, vectors, *, provider, model):
        if self.error:
            raise self.error
        self.calls.append((document_id, list(chunks), list(vectors), provider, model))


@pytest.fixture(name="factory")
def factory_fixture(engine, async_engine):
    @asynccontextmanager
    async def factory():
        async with AsyncSession(async_engine, expire_on_commit=False) as session:
            yield session

    return factory


@pytest_asyncio.fixture(name="seed")
async def seed_fixture(engine, factory):
    async def make(data=TEXT, *, name="manual.txt", status="pending", **fields):
        sha = hashlib.sha256(data + uuid.uuid4().bytes).hexdigest()
        document = Document(title="Manual", filename=name, content_type="text/plain", size_bytes=len(data),
                            sha256=sha, storage_key=f"documents/{sha}/{name}", ingestion_status=status, **fields)
        async with factory() as session:
            session.add(document)
            await session.commit()
        return document

    return make


async def load(factory, document_id):
    async with factory() as session:
        return await session.get(Document, document_id)


async def test_happy_path_goes_pending_processing_ready_and_stores_provenance(factory, seed):
    document = await seed()
    storage, embedder, writer = FakeStorage({document.storage_key: TEXT}), FakeEmbedder(), FakeWriter()
    async with factory() as session:
        assert await claim(session, document.id) is True
    assert (await load(factory, document.id)).ingestion_status == "processing"

    await run_ingestion(document.id, session_factory=factory, storage=storage, embedder=embedder, write_chunks=writer)

    done = await load(factory, document.id)
    assert done.ingestion_status == "ready" and done.error is None
    assert done.chunk_count == 1 and done.ingested_at is not None
    assert (done.embedding_provider, done.embedding_model) == ("local", "baai/bge-m3")
    (doc_id, chunks, vectors, provider, model), = writer.calls
    assert doc_id == document.id and len(chunks) == len(vectors) == 1 and (provider, model) == ("local", "baai/bge-m3")
    assert embedder.calls and "bomba de agua" in embedder.calls[0][0]


async def test_claim_is_exclusive_until_the_lock_goes_stale(factory, seed):
    document = await seed()
    async with factory() as session:
        assert await claim(session, document.id) is True
    async with factory() as session:
        assert await claim(session, document.id) is False  # another worker already owns it
    async with factory() as session:
        later = datetime.now(timezone.utc) + ingestion.STALE_AFTER + timedelta(seconds=5)
        assert await claim(session, document.id, now=later) is True  # crashed worker: reclaimable


@pytest.mark.parametrize("status", ["pending", "ready", "failed"])
async def test_claim_accepts_every_non_processing_state(factory, seed, status):
    document = await seed(status=status)
    async with factory() as session:
        assert await claim(session, document.id) is True


async def test_claim_of_unknown_document_is_false(factory):
    async with factory() as session:
        assert await claim(session, uuid.uuid4()) is False


async def test_rejected_document_fails_with_the_reason_and_never_embeds(factory, seed):
    document = await seed(b"   \n  ")
    embedder = FakeEmbedder()
    async with factory() as session:
        await claim(session, document.id)
    await run_ingestion(document.id, session_factory=factory, storage=FakeStorage({document.storage_key: b"   \n  "}),
                        embedder=embedder, write_chunks=FakeWriter())
    failed = await load(factory, document.id)
    assert failed.ingestion_status == "failed" and "texto" in failed.error
    assert embedder.calls == []


@pytest.mark.parametrize(
    "embedder_error, expected",
    [
        (EmbeddingUnavailable("provider body with sk-SECRET"), "embeddings"),
        (EmbeddingNotConfigured("x"), "no configurados"),
    ],
)
async def test_embedding_failures_fail_the_document_without_leaking_details(factory, seed, embedder_error, expected):
    document = await seed()
    async with factory() as session:
        await claim(session, document.id)
    await run_ingestion(document.id, session_factory=factory, storage=FakeStorage({document.storage_key: TEXT}),
                        embedder=FakeEmbedder(embedder_error), write_chunks=FakeWriter())
    failed = await load(factory, document.id)
    assert failed.ingestion_status == "failed" and expected in failed.error.lower()
    assert "SECRET" not in failed.error and failed.ingested_at is None


async def test_storage_failure_fails_the_document(factory, seed):
    document = await seed()
    async with factory() as session:
        await claim(session, document.id)
    await run_ingestion(document.id, session_factory=factory, storage=FakeStorage(fail=True),
                        embedder=FakeEmbedder(), write_chunks=FakeWriter())
    failed = await load(factory, document.id)
    assert failed.ingestion_status == "failed" and "almacenamiento" in failed.error.lower()


async def test_unexpected_errors_are_generic_and_never_stay_processing(factory, seed):
    document = await seed()
    async with factory() as session:
        await claim(session, document.id)
    await run_ingestion(document.id, session_factory=factory, storage=FakeStorage({document.storage_key: TEXT}),
                        embedder=FakeEmbedder(), write_chunks=FakeWriter(RuntimeError("password=hunter2")))
    failed = await load(factory, document.id)
    assert failed.ingestion_status == "failed" and "hunter2" not in failed.error


async def test_a_document_deleted_while_processing_is_ignored(factory, seed):
    await run_ingestion(uuid.uuid4(), session_factory=factory, storage=FakeStorage(), embedder=FakeEmbedder(),
                        write_chunks=FakeWriter())  # must not raise


async def test_download_is_bounded(factory, seed, monkeypatch):
    document = await seed()
    monkeypatch.setattr(ingestion.constants, "MAX_DOCUMENT_BYTES", 10)
    async with factory() as session:
        await claim(session, document.id)
    await run_ingestion(document.id, session_factory=factory, storage=FakeStorage({document.storage_key: TEXT}),
                        embedder=FakeEmbedder(), write_chunks=FakeWriter())
    assert (await load(factory, document.id)).ingestion_status == "failed"


async def test_reindex_selection_follows_provider_and_model(factory, seed):
    ok = await seed(status="ready", embedding_provider="local", embedding_model="baai/bge-m3")
    other_provider = await seed(status="ready", embedding_provider="openrouter", embedding_model="baai/bge-m3")
    other_model = await seed(status="ready", embedding_provider="local", embedding_model="intfloat/e5")
    failed = await seed(status="failed")
    pending = await seed(status="pending")
    busy = await seed(status="processing")
    async with factory() as session:
        stale = set(await select_for_reindex(session, provider="local", model="baai/bge-m3"))
        assert stale == {other_provider.id, other_model.id, failed.id, pending.id}
        everything = set(await select_for_reindex(session, provider="local", model="baai/bge-m3", everything=True))
        assert everything == {ok.id, other_provider.id, other_model.id, failed.id, pending.id}
        assert busy.id not in stale | everything
