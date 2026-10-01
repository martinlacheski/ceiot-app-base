"""POST /api/assistant/rag: auth, configuration (503), validation, error mapping, rate limit, audit."""

import uuid

import pytest

from app.api.assistant.rag import RagAnswer, RagSource, get_rag_service
from app.core import embeddings, llm
from app.core.embeddings import EmbeddingNotConfigured, EmbeddingUnavailable
from app.core.llm import LLMError
from app.main import app

URL = "/api/assistant/rag"
BODY = {"question": "¿Cada cuánto se revisa la bomba?"}


class FakeRag:
    def __init__(self, error=None):
        self.error, self.calls = error, []

    async def ask(self, question, document_id=None):
        self.calls.append((question, document_id))
        if self.error:
            raise self.error
        return RagAnswer(
            answer="Cada seis meses [Manual, p. 3].",
            sources=[RagSource(uuid.uuid4(), "Manual", 3, None, 0.21, "Revisar la bomba…")],
            trace=["embeddings-local", "pgvector-top-1", "openrouter-rag"],
        )


@pytest.fixture(name="fake_rag")
def fake_rag_fixture(client):
    fake = FakeRag()
    app.dependency_overrides[get_rag_service] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_rag_service, None)


def test_requires_authentication(client, fake_rag):
    assert client.post(URL, json=BODY).status_code == 401


def test_any_authenticated_user_may_ask(client, no_permission_headers, fake_rag):
    response = client.post(URL, json=BODY, headers=no_permission_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answer", "sources", "trace"}
    source = body["sources"][0]
    assert set(source) == {"documentId", "title", "page", "section", "distance", "excerpt"}
    assert source["page"] == 3 and source["section"] is None


def test_document_id_is_forwarded_and_validated(client, reader_headers, fake_rag):
    doc = uuid.uuid4()
    assert client.post(URL, json={**BODY, "documentId": str(doc)}, headers=reader_headers).status_code == 200
    assert fake_rag.calls[-1] == (BODY["question"], doc)
    assert client.post(URL, json={**BODY, "documentId": "nope"}, headers=reader_headers).status_code == 422


@pytest.mark.parametrize("question", ["", "ab", "x" * 501])
def test_question_length_is_validated(client, reader_headers, fake_rag, question):
    assert client.post(URL, json={"question": question}, headers=reader_headers).status_code == 422
    assert fake_rag.calls == []


def test_missing_embeddings_configuration_is_503_and_the_app_serves(client, reader_headers, monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setattr(embeddings.settings, "OPENROUTER_API_KEY", None)
    embeddings.reset_embedding_client()
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 503 and response.json()["detail"] == "Embeddings no configurados"
    assert client.get("/health").status_code == 200


def test_missing_llm_key_is_503(client, reader_headers, monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "local")
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_LOCAL_URL", "http://embeddings:80")
    embeddings.reset_embedding_client()
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", None)
    llm.reset_llm_client()
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 503 and response.json()["detail"] == "Asistente no configurado"
    embeddings.reset_embedding_client()


@pytest.mark.parametrize(
    ("error", "status"),
    [(EmbeddingNotConfigured("x"), 503), (EmbeddingUnavailable("sk-secret"), 502), (LLMError("sk-secret"), 502)],
)
def test_provider_errors_are_mapped_without_detail(client, reader_headers, fake_rag, error, status):
    fake_rag.error = error
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == status and "sk-secret" not in response.text


def test_rate_limit_is_per_user_and_blocks_before_the_service(client, reader_headers, other_reader_headers, fake_rag):
    from app.api.assistant import rate_limit

    for _ in range(rate_limit.LIMITS[0][1]):
        assert client.post(URL, json=BODY, headers=reader_headers).status_code == 200
    blocked = client.post(URL, json=BODY, headers=reader_headers)
    assert blocked.status_code == 429 and 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert client.post(URL, json=BODY, headers=other_reader_headers).status_code == 200
    assert len(fake_rag.calls) == rate_limit.LIMITS[0][1] + 1
