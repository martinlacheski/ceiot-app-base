"""Embeddings client for RAG: OpenRouter or a local Text Embeddings Inference server.

Both providers speak the OpenAI ``/embeddings`` shape, so one client serves
them: ``openrouter`` posts to ``{OPENROUTER_BASE_URL}/embeddings`` with the API
key; ``local`` posts to ``{EMBEDDING_LOCAL_URL}/v1/embeddings`` (TEI, no key).
The model is BAAI/bge-m3 (1024 dimensions) in both cases.

Like ``app.core.llm`` the client is built on demand: the app boots without any
embeddings configuration and the RAG endpoints answer 503. Errors are sanitized
(no provider body, no request text, no key). One retry for 429/5xx/transport
errors; vectors are validated (count, dimensions, finite, non-zero) and
L2-normalized client-side so cosine distance is comparable across providers.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any, Awaitable, Callable, Sequence

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 1024
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
RETRY_BACKOFF_SECONDS = 0.5
# CPU inference of a 1200-character batch takes a while; OpenRouter answers fast.
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=5.0)
DEFAULT_BATCH_SIZE = {"openrouter": 32, "local": 8}
OPENROUTER_MODEL_IDS = {"baai/bge-m3": "baai/bge-m3"}


class EmbeddingError(RuntimeError):
    """Any embeddings failure, with a message that is safe to show or log."""


class EmbeddingNotConfigured(EmbeddingError):
    """Missing key or local URL: RAG is disabled (the rest of the app is unaffected)."""


class EmbeddingUnavailable(EmbeddingError):
    """The provider failed, timed out or answered something unusable."""


def canonical_model(model: str) -> str:
    """Identity stored with every chunk: trimmed and lowercase, so case never forces a re-index."""
    return model.strip().lower()


def openrouter_model_id(model: str) -> str:
    """Map the configured name (``BAAI/bge-m3``) to OpenRouter's lowercase id."""
    key = canonical_model(model)
    return OPENROUTER_MODEL_IDS.get(key, model.strip())


def current_identity() -> tuple[str, str]:
    """(provider, model) the app is configured for now; needs no credentials."""
    return settings.EMBEDDING_PROVIDER, canonical_model(settings.MODELO_EMBEDDING)


def to_vector_literal(vector: Sequence[float]) -> str:
    """pgvector text input format, cast server-side with ``CAST(:v AS vector)``."""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"


class EmbeddingClient:
    def __init__(
        self,
        *,
        provider: str,
        model: str,
        api_key: str | None = None,
        base_url: str = "https://openrouter.ai/api/v1",
        local_url: str | None = None,
        batch_size: int | None = None,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if provider not in DEFAULT_BATCH_SIZE:
            raise ValueError(f"Unknown embedding provider: {provider!r}")
        self.provider = provider
        self.model = canonical_model(model)
        self._configured_model = model
        self._api_key = (api_key or "").strip()
        self._base_url = base_url.rstrip("/")
        self._local_url = (local_url or "").strip().rstrip("/")
        self._batch_size = max(1, batch_size or DEFAULT_BATCH_SIZE[provider])
        self._http = http
        self._sleep = sleep

    def __repr__(self) -> str:  # never leak the key through repr/logging
        return f"EmbeddingClient(provider={self.provider!r}, model={self.model!r})"

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    def _request_parts(self) -> tuple[str, dict[str, str], str]:
        if self.provider == "openrouter":
            if not self._api_key:
                raise EmbeddingNotConfigured("Embeddings no configurados")
            headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
            return f"{self._base_url}/embeddings", headers, openrouter_model_id(self._configured_model)
        if not self._local_url:
            raise EmbeddingNotConfigured("Embeddings no configurados")
        return f"{self._local_url}/v1/embeddings", {"Content-Type": "application/json"}, self._configured_model.strip()

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed ``texts`` in order: unit-length vectors of :data:`EMBEDDING_DIMENSIONS` floats."""
        url, headers, model_id = self._request_parts()
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = list(texts[start : start + self._batch_size])
            vectors.extend(await self._embed_batch(url, headers, model_id, batch))
        return vectors

    async def _embed_batch(
        self, url: str, headers: dict[str, str], model_id: str, batch: list[str]
    ) -> list[list[float]]:
        payload = {"model": model_id, "input": batch, "encoding_format": "float"}
        for attempt in (1, 2):
            try:
                response = await self._client().post(url, headers=headers, json=payload)
            except httpx.HTTPError:
                if attempt == 1:
                    await self._sleep(RETRY_BACKOFF_SECONDS)
                    continue
                raise EmbeddingUnavailable("El servicio de embeddings no respondió") from None
            if response.status_code in RETRYABLE_STATUS and attempt == 1:
                await self._sleep(RETRY_BACKOFF_SECONDS)
                continue
            if response.status_code != 200:
                logger.warning("Embeddings provider answered HTTP %s", response.status_code)
                raise EmbeddingUnavailable(f"El servicio de embeddings devolvió un error (HTTP {response.status_code})")
            return _parse(response, expected=len(batch))
        raise EmbeddingUnavailable("El servicio de embeddings no respondió")  # pragma: no cover


def _parse(response: httpx.Response, *, expected: int) -> list[list[float]]:
    invalid = EmbeddingUnavailable("Respuesta inválida del servicio de embeddings")
    try:
        data: Any = response.json()["data"]
    except (ValueError, KeyError, TypeError):
        raise invalid from None
    if not isinstance(data, list) or len(data) != expected:
        raise invalid
    slots: list[list[float] | None] = [None] * expected
    for item in data:
        try:
            index, raw = item["index"], item["embedding"]
        except (KeyError, TypeError):
            raise invalid from None
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < expected or slots[index] is not None:
            raise invalid
        slots[index] = _normalize(raw, invalid)
    return [vector for vector in slots if vector is not None]


def _normalize(raw: Any, invalid: EmbeddingError) -> list[float]:
    if not isinstance(raw, list) or len(raw) != EMBEDDING_DIMENSIONS:
        raise invalid
    try:
        vector = [float(value) for value in raw]
    except (TypeError, ValueError):
        raise invalid from None
    if not all(math.isfinite(value) for value in vector):
        raise invalid
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm == 0.0:
        raise invalid
    return [value / norm for value in vector]


_client: EmbeddingClient | None = None


def get_embedding_client() -> EmbeddingClient:
    """Shared client (one HTTP pool). Raises :class:`EmbeddingNotConfigured` when unconfigured."""
    global _client
    provider, model = current_identity()
    key = settings.OPENROUTER_API_KEY.get_secret_value() if settings.OPENROUTER_API_KEY else ""
    local_url = (settings.EMBEDDING_LOCAL_URL or "").strip()
    if provider == "openrouter" and not key.strip():
        raise EmbeddingNotConfigured("Embeddings no configurados")
    if provider == "local" and not local_url:
        raise EmbeddingNotConfigured("Embeddings no configurados")
    if _client is None or (_client.provider, _client.model) != (provider, model):
        _client = EmbeddingClient(
            provider=provider,
            model=settings.MODELO_EMBEDDING,
            api_key=key,
            base_url=settings.OPENROUTER_BASE_URL,
            local_url=local_url,
        )
    return _client


def reset_embedding_client() -> None:
    global _client
    _client = None


async def close_embeddings() -> None:
    global _client
    client, _client = _client, None
    if client is not None:
        try:
            await client.aclose()
        except Exception:  # shutdown must never fail because of the embeddings client
            logger.debug("Ignoring embeddings client close failure", exc_info=True)


def get_embedder() -> EmbeddingClient:
    """FastAPI dependency: the shared client, or 503 when embeddings are not configured."""
    from fastapi import HTTPException, status

    try:
        return get_embedding_client()
    except EmbeddingNotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Embeddings no configurados") from None


def get_optional_embedder() -> EmbeddingClient | None:
    """FastAPI dependency for flows that degrade (uploads stay ``pending`` without embeddings)."""
    try:
        return get_embedding_client()
    except EmbeddingNotConfigured:
        return None
