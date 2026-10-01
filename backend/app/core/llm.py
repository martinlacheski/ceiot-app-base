"""OpenRouter chat client for the assistant (OpenAI-compatible, deterministic, bounded).

The app boots and works without ``OPENROUTER_API_KEY``: the client is only built
on demand and raises :class:`LLMNotConfigured` (mapped to HTTP 503) when the key
is missing. Errors are sanitized on purpose: provider response bodies, request
payloads and headers can contain keys or user data, so they are never put in an
exception message or a log line.

Retry policy: one retry, only for 429/5xx and transport timeouts/errors, after a
short backoff. These are the transient failures a provider answers well on the
next try; the request is idempotent (temperature 0, no side effects) and the
worst case is two billed calls, so the retry is bounded. 4xx other than 429
(bad key, no credit, invalid request) are never retried.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
RETRY_BACKOFF_SECONDS = 0.5
REQUEST_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class LLMError(RuntimeError):
    """Any provider failure, with a message that is safe to show or log."""


class LLMNotConfigured(LLMError):
    """No API key: the assistant is disabled (the rest of the app is unaffected)."""


class OpenRouterClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        base_url: str = "https://openrouter.ai/api/v1",
        max_completion_tokens: int = 400,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self.model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._max_completion_tokens = max(1, max_completion_tokens)
        self._http = http
        self._sleep = sleep

    def __repr__(self) -> str:  # never leak the key through repr/logging
        return f"OpenRouterClient(model={self.model!r}, configured={bool(self._api_key)})"

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def chat(self, messages: list[dict[str, str]], *, max_completion_tokens: int | None = None) -> str:
        if not self._api_key:
            raise LLMNotConfigured("Asistente no configurado")
        budget = min(max(1, max_completion_tokens or self._max_completion_tokens), self._max_completion_tokens)
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "max_completion_tokens": budget,
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        for attempt in (1, 2):
            try:
                response = await self._client().post(self._url, headers=headers, json=payload)
            except httpx.HTTPError:
                if attempt == 1:
                    await self._sleep(RETRY_BACKOFF_SECONDS)
                    continue
                raise LLMError("El proveedor de IA no respondió") from None
            if response.status_code in RETRYABLE_STATUS and attempt == 1:
                await self._sleep(RETRY_BACKOFF_SECONDS)
                continue
            if response.status_code != 200:
                logger.warning("LLM provider answered HTTP %s", response.status_code)
                raise LLMError(f"El proveedor de IA devolvió un error (HTTP {response.status_code})")
            return _extract_content(response)
        raise LLMError("El proveedor de IA no respondió")  # pragma: no cover


def _extract_content(response: httpx.Response) -> str:
    try:
        data: Any = response.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise LLMError("Respuesta inválida del proveedor de IA") from None
    if not isinstance(content, str) or not content.strip():
        raise LLMError("Respuesta vacía del proveedor de IA")
    return content.strip()


_client: OpenRouterClient | None = None


def get_llm_client() -> OpenRouterClient:
    """Shared client (one HTTP pool). Raises :class:`LLMNotConfigured` without a key."""
    global _client
    key = settings.OPENROUTER_API_KEY.get_secret_value() if settings.OPENROUTER_API_KEY else ""
    if not key.strip():
        raise LLMNotConfigured("Asistente no configurado")
    if _client is None:
        _client = OpenRouterClient(
            api_key=key,
            model=settings.OPENROUTER_MODEL,
            base_url=settings.OPENROUTER_BASE_URL,
            max_completion_tokens=settings.OPENROUTER_MAX_COMPLETION_TOKENS,
        )
    return _client


def reset_llm_client() -> None:
    global _client
    _client = None


async def close_llm() -> None:
    global _client
    client, _client = _client, None
    if client is not None:
        try:
            await client.aclose()
        except Exception:  # shutdown must never fail because of the LLM client
            logger.debug("Ignoring LLM client close failure", exc_info=True)
