"""POST /api/assistant/chat: auth, configuration (503), validation, permissions, error mapping, rate limit."""

import pytest

from app.api.assistant import rate_limit
from app.api.assistant.chat import ChatAnswer, ChatRoute, ChatSql, DatosForbidden
from app.api.assistant.rag import RagSource
from app.api.assistant.router import get_chat_service
from app.api.assistant.service import Unanswerable
from app.api.assistant.sql_executor import QueryFailed
from app.api.assistant.sql_guard import SQLRejected
from app.core import llm
from app.core.embeddings import EmbeddingUnavailable
from app.core.llm import LLMError
from app.main import app

import uuid

URL = "/api/assistant/chat"
BODY = {"question": "¿Qué precisión tiene el DHT22?"}


class FakeChat:
    def __init__(self, error=None):
        self.error, self.calls = error, []

    async def ask(self, question, mode, history):
        self.calls.append((question, mode, history))
        if self.error:
            raise self.error
        return ChatAnswer(
            answer="Precisión ±0,5 °C [Hoja, p. 2].",
            route=ChatRoute(datos=True, documentos=True, mode=mode),
            sql=ChatSql("SELECT 1 LIMIT 1", ["promedio"], [{"promedio": 21.5}], False),
            sources=[RagSource(uuid.uuid4(), "Hoja", 2, None, 0.3, "Precisión…")],
            trace=["orquestador"],
            warnings=["aviso"],
        )


@pytest.fixture(name="fake_chat")
def fake_chat_fixture(client):
    fake = FakeChat()
    app.dependency_overrides[get_chat_service] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_chat_service, None)


def test_requires_authentication(client, fake_chat):
    assert client.post(URL, json=BODY).status_code == 401


def test_response_shape_and_camel_case(client, no_permission_headers, fake_chat):
    response = client.post(URL, json=BODY, headers=no_permission_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answer", "route", "sql", "sources", "trace", "warnings"}
    assert body["route"] == {"datos": True, "documentos": True, "mode": "auto"}
    assert set(body["sql"]) == {"query", "columns", "rows", "truncated"}
    assert set(body["sources"][0]) == {"documentId", "title", "page", "section", "distance", "excerpt"}


def test_mode_and_history_are_validated_and_forwarded(client, reader_headers, fake_chat):
    history = [{"role": "user", "content": "hola"}, {"role": "assistant", "content": "¿en qué ayudo?"}]
    ok = client.post(URL, json={**BODY, "mode": "datos", "history": history}, headers=reader_headers)
    assert ok.status_code == 200
    question, mode, forwarded = fake_chat.calls[-1]
    assert mode == "datos" and [(t.role, t.content) for t in forwarded] == [("user", "hola"), ("assistant", "¿en qué ayudo?")]
    bad = [
        {**BODY, "mode": "otro"},
        {**BODY, "history": [{"role": "system", "content": "x"}]},
        {**BODY, "history": [{"role": "user", "content": "x" * 1001}]},
        {**BODY, "history": [{"role": "user", "content": "x"}] * 21},
    ]
    for payload in bad:
        assert client.post(URL, json=payload, headers=reader_headers).status_code == 422
    assert len(fake_chat.calls) == 1


@pytest.mark.parametrize("question", ["", "ab", "x" * 501])
def test_question_length_is_validated(client, reader_headers, fake_chat, question):
    assert client.post(URL, json={"question": question}, headers=reader_headers).status_code == 422
    assert fake_chat.calls == []


def test_missing_llm_key_is_503(client, reader_headers, monkeypatch):
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", None)
    llm.reset_llm_client()
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 503 and response.json()["detail"] == "Asistente no configurado"
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (DatosForbidden(), 403),
        (Unanswerable(), 422),
        (SQLRejected("no_select", "interno"), 422),
        (QueryFailed("timeout"), 504),
        (QueryFailed("database"), 503),
        (LLMError("sk-secret"), 502),
        (EmbeddingUnavailable("sk-secret"), 502),
    ],
)
def test_errors_are_mapped_without_detail(client, reader_headers, fake_chat, error, status):
    fake_chat.error = error
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == status
    assert "sk-secret" not in response.text and "interno" not in response.text


def test_admin_sees_the_rejection_reason_others_do_not(client, admin_reader_headers, reader_headers, fake_chat):
    fake_chat.error = SQLRejected("no_select", "interno")
    assert "interno" in client.post(URL, json=BODY, headers=admin_reader_headers).json()["detail"]
    assert "interno" not in client.post(URL, json=BODY, headers=reader_headers).json()["detail"]


def test_rate_limit_is_per_user_and_charged_once_per_message(client, reader_headers, other_reader_headers, fake_chat):
    for _ in range(rate_limit.LIMITS[0][1]):
        assert client.post(URL, json=BODY, headers=reader_headers).status_code == 200
    blocked = client.post(URL, json=BODY, headers=reader_headers)
    assert blocked.status_code == 429 and 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert client.post(URL, json=BODY, headers=other_reader_headers).status_code == 200
    assert len(fake_chat.calls) == rate_limit.LIMITS[0][1] + 1
