"""OpenRouter chat client: typed missing key, sanitized errors, bounded retry, no secrets in errors."""

import json

import httpx
import pytest

from app.core import llm
from app.core.llm import LLMError, LLMNotConfigured, OpenRouterClient

pytestmark = pytest.mark.asyncio

SECRET = "sk-or-test-SECRET-123"


def _client(handler, *, key=SECRET, sleeps=None, **kwargs):
    async def fake_sleep(seconds):
        if sleeps is not None:
            sleeps.append(seconds)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OpenRouterClient(api_key=key, model="openai/gpt-4o-mini", http=http, sleep=fake_sleep, **kwargs)


def _ok(content="hola"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


async def test_missing_or_blank_key_raises_typed_error_without_any_request():
    calls = []
    for key in (None, "", "   "):
        client = _client(lambda request: calls.append(request) or _ok(), key=key)
        with pytest.raises(LLMNotConfigured):
            await client.chat([{"role": "user", "content": "x"}])
    assert calls == []
    assert issubclass(LLMNotConfigured, LLMError)


async def test_request_shape_is_deterministic_and_bounded():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return _ok("  respuesta  ")

    client = _client(handler, max_completion_tokens=300)
    out = await client.chat([{"role": "system", "content": "s"}, {"role": "user", "content": "u"}], max_completion_tokens=9999)
    assert out == "respuesta"
    assert seen["url"].endswith("/chat/completions")
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["body"]["model"] == "openai/gpt-4o-mini"
    assert seen["body"]["temperature"] == 0
    assert seen["body"]["max_completion_tokens"] == 300  # the global cap wins over a larger ask
    assert seen["body"]["messages"][1] == {"role": "user", "content": "u"}


async def test_smaller_per_call_budget_is_respected():
    seen = {}
    client = _client(lambda r: seen.update(body=json.loads(r.content)) or _ok(), max_completion_tokens=300)
    await client.chat([{"role": "user", "content": "u"}], max_completion_tokens=120)
    assert seen["body"]["max_completion_tokens"] == 120


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
async def test_one_retry_on_transient_status_then_success(status):
    responses = [httpx.Response(status, text="boom"), _ok("listo")]
    sleeps = []
    client = _client(lambda r: responses.pop(0), sleeps=sleeps)
    assert await client.chat([{"role": "user", "content": "u"}]) == "listo"
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 2


async def test_retry_is_attempted_once_only():
    calls = []
    client = _client(lambda r: calls.append(1) or httpx.Response(503, text="leak-body"))
    with pytest.raises(LLMError):
        await client.chat([{"role": "user", "content": "u"}])
    assert len(calls) == 2


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404])
async def test_client_errors_are_not_retried(status):
    calls = []
    client = _client(lambda r: calls.append(1) or httpx.Response(status, text="x"))
    with pytest.raises(LLMError):
        await client.chat([{"role": "user", "content": "u"}])
    assert len(calls) == 1


async def test_timeouts_and_network_errors_are_sanitized_and_retried_once():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectTimeout("timed out connecting to https://openrouter.ai with " + SECRET)

    client = _client(handler)
    with pytest.raises(LLMError) as caught:
        await client.chat([{"role": "user", "content": "u"}])
    assert len(calls) == 2
    assert SECRET not in str(caught.value) and "openrouter.ai" not in str(caught.value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"choices": []}),
        httpx.Response(200, json={"choices": [{"message": {"content": "   "}}]}),
        httpx.Response(200, json={"choices": [{"message": {"content": 5}}]}),
        httpx.Response(200, json={"error": {"message": "secret provider detail"}}),
    ],
)
async def test_malformed_or_empty_bodies_raise_without_echoing_them(response):
    client = _client(lambda r: response)
    with pytest.raises(LLMError) as caught:
        await client.chat([{"role": "user", "content": "u"}])
    assert "secret provider detail" not in str(caught.value) and SECRET not in str(caught.value)


async def test_error_text_never_contains_the_response_body_or_the_key():
    client = _client(lambda r: httpx.Response(401, text=f"bad key {SECRET} please"))
    with pytest.raises(LLMError) as caught:
        await client.chat([{"role": "user", "content": "u"}])
    assert SECRET not in str(caught.value) and "please" not in str(caught.value)
    assert repr(client).count(SECRET) == 0


async def test_get_llm_client_depends_on_settings(monkeypatch):
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", None)
    llm.reset_llm_client()
    with pytest.raises(LLMNotConfigured):
        llm.get_llm_client()
    from pydantic import SecretStr

    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", SecretStr(SECRET))
    llm.reset_llm_client()
    client = llm.get_llm_client()
    assert llm.get_llm_client() is client  # reused, so the HTTP connection pool is reused
    llm.reset_llm_client()
