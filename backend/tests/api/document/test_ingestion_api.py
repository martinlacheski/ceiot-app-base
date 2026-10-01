"""Ingestion endpoints: auto-trigger after upload, manual ingest, reindex, 503 degradation."""

import uuid
from contextlib import asynccontextmanager

import pytest
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.document.router import get_ingestion_runtime, IngestionRuntime
from app.core import embeddings
from app.core.embeddings import EMBEDDING_DIMENSIONS, get_embedder, get_optional_embedder
from app.main import app

BASE = "/api/documents"
TEXT = ("La bomba de agua debe revisarse cada seis meses. " * 4).encode()


class FakeEmbedder:
    provider = "local"
    model = "baai/bge-m3"

    def __init__(self):
        self.calls = 0

    async def embed(self, texts):
        self.calls += 1
        return [[1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1) for _ in texts]


class FakeWriter:
    def __init__(self):
        self.documents = []

    async def __call__(self, session, document_id, chunks, vectors, *, provider, model):
        self.documents.append((document_id, len(chunks), provider, model))


@pytest.fixture(name="stack")
def stack_fixture(client, storage, async_engine):
    embedder, writer = FakeEmbedder(), FakeWriter()

    @asynccontextmanager
    async def factory():
        async with AsyncSession(async_engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_embedder] = lambda: embedder
    app.dependency_overrides[get_optional_embedder] = lambda: embedder
    app.dependency_overrides[get_ingestion_runtime] = lambda: IngestionRuntime(factory, writer)
    return embedder, writer


@pytest.fixture(autouse=True)
def _current_identity(monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "local")
    monkeypatch.setattr(embeddings.settings, "MODELO_EMBEDDING", "BAAI/bge-m3")


def upload(client, headers, name="notes.txt", data=TEXT, title=None):
    return client.post(BASE, headers=headers, files={"file": (name, data, "text/plain")},
                       data={"title": title} if title else None)


def get(client, headers, doc_id):
    return client.get(f"{BASE}/{doc_id}", headers=headers).json()


def test_upload_triggers_ingestion_in_the_background(client, stack, admin_headers):
    embedder, writer = stack
    response = upload(client, admin_headers)
    assert response.status_code == 201
    assert response.json()["ingestionStatus"] == "processing"
    doc = get(client, admin_headers, response.json()["id"])  # the background task finished with the response
    assert doc["ingestionStatus"] == "ready" and doc["chunkCount"] == 1
    assert (doc["embeddingProvider"], doc["embeddingModel"]) == ("local", "baai/bge-m3")
    assert doc["needsReindex"] is False and doc["ingestedAt"] is not None
    assert writer.documents and embedder.calls == 1


def test_upload_without_embeddings_stays_pending_and_succeeds(client, storage, admin_headers):
    response = upload(client, admin_headers)
    assert response.status_code == 201 and response.json()["ingestionStatus"] == "pending"


def test_manual_ingest_requires_admin(client, stack, user_headers):
    assert client.post(f"{BASE}/{uuid.uuid4()}/ingest").status_code == 401
    assert client.post(f"{BASE}/{uuid.uuid4()}/ingest", headers=user_headers).status_code == 403
    assert client.post(f"{BASE}/reindex", headers=user_headers).status_code == 403


def test_manual_ingest_of_a_pending_document(client, stack, admin_headers):
    app.dependency_overrides[get_optional_embedder] = lambda: None  # upload stays pending
    doc_id = upload(client, admin_headers).json()["id"]
    assert get(client, admin_headers, doc_id)["ingestionStatus"] == "pending"
    response = client.post(f"{BASE}/{doc_id}/ingest", headers=admin_headers)
    assert response.status_code == 202 and response.json()["ingestionStatus"] == "processing"
    assert get(client, admin_headers, doc_id)["ingestionStatus"] == "ready"


def test_ingest_unknown_document_is_404(client, stack, admin_headers):
    assert client.post(f"{BASE}/{uuid.uuid4()}/ingest", headers=admin_headers).status_code == 404


def test_ingest_while_processing_is_409(client, stack, admin_headers, session):
    from app.api.document.models import Document

    doc_id = upload(client, admin_headers).json()["id"]
    row = session.get(Document, uuid.UUID(doc_id))
    row.ingestion_status = "processing"
    session.add(row)
    session.commit()
    assert client.post(f"{BASE}/{doc_id}/ingest", headers=admin_headers).status_code == 409


def test_ingest_without_embeddings_is_503(client, storage, admin_headers, monkeypatch):
    doc_id = upload(client, admin_headers).json()["id"]
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setattr(embeddings.settings, "OPENROUTER_API_KEY", None)
    embeddings.reset_embedding_client()
    app.dependency_overrides.pop(get_embedder, None)
    response = client.post(f"{BASE}/{doc_id}/ingest", headers=admin_headers)
    assert response.status_code == 503 and response.json()["detail"] == "Embeddings no configurados"
    assert client.get(f"{BASE}/{doc_id}", headers=admin_headers).status_code == 200  # the rest keeps working


def test_failed_ingestion_is_visible_with_a_safe_error(client, stack, admin_headers):
    response = upload(client, admin_headers, "vacio.txt", b"   \n ")
    doc = get(client, admin_headers, response.json()["id"])
    assert doc["ingestionStatus"] == "failed" and "texto" in doc["error"]


def test_needs_reindex_when_provider_or_model_changed(client, stack, admin_headers, monkeypatch):
    doc_id = upload(client, admin_headers).json()["id"]
    assert get(client, admin_headers, doc_id)["needsReindex"] is False
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    assert get(client, admin_headers, doc_id)["needsReindex"] is True
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "local")
    monkeypatch.setattr(embeddings.settings, "MODELO_EMBEDDING", "other/model")
    listed = client.get(BASE, headers=admin_headers).json()["items"][0]
    assert listed["needsReindex"] is True
    monkeypatch.setattr(embeddings.settings, "MODELO_EMBEDDING", "BAAI/BGE-M3")  # case never forces a reindex
    assert get(client, admin_headers, doc_id)["needsReindex"] is False


def test_reindex_only_touches_stale_documents_unless_all(client, stack, admin_headers, monkeypatch):
    embedder, writer = stack
    first = upload(client, admin_headers, "a.txt", TEXT).json()["id"]
    second = upload(client, admin_headers, "b.txt", TEXT + b" distinto").json()["id"]
    assert embedder.calls == 2

    nothing = client.post(f"{BASE}/reindex", headers=admin_headers)
    assert nothing.status_code == 202 and nothing.json() == {"queued": 0, "documentIds": []}

    forced = client.post(f"{BASE}/reindex", headers=admin_headers, params={"all": "true"})
    assert forced.json()["queued"] == 2 and embedder.calls == 4

    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    embedder.provider = "openrouter"
    stale = client.post(f"{BASE}/reindex", headers=admin_headers)
    assert stale.json()["queued"] == 2 and set(stale.json()["documentIds"]) == {first, second}
    assert get(client, admin_headers, first)["embeddingProvider"] == "openrouter"
    assert get(client, admin_headers, first)["needsReindex"] is False


def test_reindex_without_embeddings_is_503(client, storage, admin_headers, monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setattr(embeddings.settings, "OPENROUTER_API_KEY", None)
    embeddings.reset_embedding_client()
    assert client.post(f"{BASE}/reindex", headers=admin_headers).status_code == 503
