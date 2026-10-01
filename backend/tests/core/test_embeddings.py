"""Embeddings client: OpenRouter and local TEI shapes, batching, validation, errors, no secrets."""

import json
import math

import httpx
import pytest
from pydantic import SecretStr

from app.core import embeddings
from app.core.embeddings import (
    EMBEDDING_DIMENSIONS,
    EmbeddingClient,
    EmbeddingError,
    EmbeddingNotConfigured,
    EmbeddingUnavailable,
    canonical_model,
    openrouter_model_id,
    to_vector_literal,
)

pytestmark = pytest.mark.asyncio

SECRET = "sk-or-test-SECRET-123"


def _vec(seed: float = 1.0, dims: int = EMBEDDING_DIMENSIONS) -> list[float]:
    return [seed + (i % 7) for i in range(dims)]


def _ok(count: int, *, dims: int = EMBEDDING_DIMENSIONS, shuffled: bool = False):
    data = [{"object": "embedding", "index": i, "embedding": _vec(i + 1, dims)} for i in range(count)]
    if shuffled:
        data.reverse()
    return httpx.Response(200, json={"data": data, "model": "x"})


def _client(handler, *, provider="openrouter", key=SECRET, url="http://embeddings:80", sleeps=None, **kwargs):
    async def fake_sleep(seconds):
        if sleeps is not None:
            sleeps.append(seconds)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return EmbeddingClient(
        provider=provider,
        model="BAAI/bge-m3",
        api_key=key,
        base_url="https://openrouter.ai/api/v1",
        local_url=url,
        http=http,
        sleep=fake_sleep,
        **kwargs,
    )


async def test_model_id_mapping_is_case_insensitive_and_identity_is_lowercase():
    assert openrouter_model_id("BAAI/bge-m3") == "baai/bge-m3"
    assert openrouter_model_id("baai/BGE-M3") == "baai/bge-m3"
    assert openrouter_model_id("other/model") == "other/model"
    assert canonical_model(" BAAI/bge-m3 ") == "baai/bge-m3"


async def test_vector_literal_is_pgvector_text_format():
    assert to_vector_literal([1.0, 0.5, -2.0]) == "[1.0,0.5,-2.0]"


async def test_openrouter_request_shape_and_normalization():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return _ok(2)

    client = _client(handler)
    vectors = await client.embed(["uno", "dos"])
    assert seen["url"] == "https://openrouter.ai/api/v1/embeddings"
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["body"]["model"] == "baai/bge-m3"
    assert seen["body"]["input"] == ["uno", "dos"]
    assert len(vectors) == 2 and all(len(v) == EMBEDDING_DIMENSIONS for v in vectors)
    for vector in vectors:
        assert math.isclose(math.sqrt(sum(x * x for x in vector)), 1.0, rel_tol=1e-9)


async def test_local_tei_shape_has_no_authorization_and_uses_v1_embeddings():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return _ok(1)

    client = _client(handler, provider="local", key=None, url="http://embeddings:8080/")
    await client.embed(["hola"])
    assert seen["url"] == "http://embeddings:8080/v1/embeddings"
    assert seen["auth"] is None
    assert seen["body"]["input"] == ["hola"]
    assert client.provider == "local" and client.model == "baai/bge-m3"


async def test_results_are_reordered_by_index():
    client = _client(lambda request: _ok(3, shuffled=True))
    vectors = await client.embed(["a", "b", "c"])
    # the seed grows with the index, so the normalized vectors must be distinguishable and ordered
    expected = [_vec(i + 1) for i in range(3)]
    for vector, raw in zip(vectors, expected):
        norm = math.sqrt(sum(x * x for x in raw))
        assert math.isclose(vector[0], raw[0] / norm, rel_tol=1e-9)


async def test_batches_split_requests_and_keep_order():
    sizes = []

    def handler(request):
        sizes.append(len(json.loads(request.content)["input"]))
        return _ok(sizes[-1])

    client = _client(handler, batch_size=3)
    vectors = await client.embed([f"t{i}" for i in range(7)])
    assert sizes == [3, 3, 1] and len(vectors) == 7


async def test_empty_input_makes_no_request():
    calls = []
    client = _client(lambda request: calls.append(request) or _ok(0))
    assert await client.embed([]) == []
    assert calls == []


async def test_missing_key_or_url_is_typed_and_makes_no_request():
    calls = []
    for key in (None, "", "   "):
        client = _client(lambda request: calls.append(request) or _ok(1), key=key)
        with pytest.raises(EmbeddingNotConfigured):
            await client.embed(["x"])
    for url in (None, "", "  "):
        client = _client(lambda request: calls.append(request) or _ok(1), provider="local", key=None, url=url)
        with pytest.raises(EmbeddingNotConfigured):
            await client.embed(["x"])
    assert calls == [] and issubclass(EmbeddingNotConfigured, EmbeddingError)


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_one_retry_on_transient_status(status):
    attempts, sleeps = [], []

    def handler(request):
        attempts.append(1)
        return httpx.Response(status) if len(attempts) == 1 else _ok(1)

    client = _client(handler, sleeps=sleeps)
    assert len(await client.embed(["x"])) == 1
    assert len(attempts) == 2 and len(sleeps) == 1


async def test_retry_is_bounded_to_one_and_error_is_sanitized():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(503, text=f"upstream said {SECRET} and the user text")

    client = _client(handler)
    with pytest.raises(EmbeddingUnavailable) as caught:
        await client.embed(["texto privado"])
    assert len(attempts) == 2
    assert SECRET not in str(caught.value) and "privado" not in str(caught.value)


async def test_client_errors_are_not_retried():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(401, text="bad key")

    client = _client(handler)
    with pytest.raises(EmbeddingUnavailable):
        await client.embed(["x"])
    assert len(attempts) == 1


async def test_transport_error_is_retried_once_then_typed():
    attempts = []

    def handler(request):
        attempts.append(1)
        raise httpx.ConnectError("boom")

    client = _client(handler)
    with pytest.raises(EmbeddingUnavailable):
        await client.embed(["x"])
    assert len(attempts) == 2


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={}),
        httpx.Response(200, json={"data": "nope"}),
        _ok(1, dims=512),  # wrong dimensions
        _ok(2),  # wrong count for a single input
        httpx.Response(200, content=b'{"data": [{"index": 0, "embedding": [' + b",".join([b"NaN"] * EMBEDDING_DIMENSIONS) + b"]}]}"),
        httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.0] * EMBEDDING_DIMENSIONS}]}),
        httpx.Response(200, json={"data": [{"index": 0, "embedding": ["a"] * EMBEDDING_DIMENSIONS}]}),
        httpx.Response(200, json={"data": [{"index": 5, "embedding": _vec()}]}),
    ],
)
async def test_invalid_responses_are_rejected(response):
    client = _client(lambda request: response)
    with pytest.raises(EmbeddingError):
        await client.embed(["x"])


async def test_repr_never_leaks_the_key():
    client = _client(lambda request: _ok(1))
    assert SECRET not in repr(client)


async def test_factory_reads_settings(monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setattr(embeddings.settings, "OPENROUTER_API_KEY", None)
    embeddings.reset_embedding_client()
    with pytest.raises(EmbeddingNotConfigured):
        embeddings.get_embedding_client()

    monkeypatch.setattr(embeddings.settings, "OPENROUTER_API_KEY", SecretStr(SECRET))
    embeddings.reset_embedding_client()
    client = embeddings.get_embedding_client()
    assert client.provider == "openrouter" and client.model == "baai/bge-m3"

    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "local")
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_LOCAL_URL", None)
    embeddings.reset_embedding_client()
    with pytest.raises(EmbeddingNotConfigured):
        embeddings.get_embedding_client()

    monkeypatch.setattr(embeddings.settings, "EMBEDDING_LOCAL_URL", "http://embeddings:80")
    embeddings.reset_embedding_client()
    assert embeddings.get_embedding_client().provider == "local"
    embeddings.reset_embedding_client()


async def test_current_identity_follows_settings_without_needing_credentials(monkeypatch):
    monkeypatch.setattr(embeddings.settings, "EMBEDDING_PROVIDER", "local")
    monkeypatch.setattr(embeddings.settings, "MODELO_EMBEDDING", "BAAI/bge-m3")
    assert embeddings.current_identity() == ("local", "baai/bge-m3")
