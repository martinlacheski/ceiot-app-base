"""POST /api/assistant/sql: auth, permission, configuration, error mapping, rate limit."""

import pytest
from pydantic import SecretStr

from app.api.assistant.service import Unanswerable
from app.api.assistant.sql_executor import QueryFailed
from app.api.assistant.sql_guard import SQLRejected
from app.core import llm
from app.core.llm import LLMError

URL = "/api/assistant/sql"
BODY = {"question": "¿Cuál fue la temperatura promedio de ayer?"}


def test_requires_authentication(client):
    assert client.post(URL, json=BODY).status_code == 401


def test_requires_telemetry_read(client, no_permission_headers, fake_service):
    response = client.post(URL, json=BODY, headers=no_permission_headers)
    assert response.status_code == 403
    assert fake_service.questions == []


def test_missing_api_key_answers_503_and_the_app_still_serves(client, reader_headers, monkeypatch):
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", None)
    llm.reset_llm_client()
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 503
    assert response.json()["detail"] == "Asistente no configurado"
    assert client.get("/health").status_code == 200


def test_blank_api_key_is_also_not_configured(client, reader_headers, monkeypatch):
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", SecretStr("   "))
    llm.reset_llm_client()
    assert client.post(URL, json=BODY, headers=reader_headers).status_code == 503


@pytest.mark.parametrize("question", ["", "ab", "x" * 501, "   ab   "])
def test_question_length_is_validated(client, reader_headers, fake_service, question):
    assert client.post(URL, json={"question": question}, headers=reader_headers).status_code == 422
    assert fake_service.questions == []


def test_missing_question_is_422(client, reader_headers, fake_service):
    assert client.post(URL, json={}, headers=reader_headers).status_code == 422


def test_happy_path_shape(client, reader_headers, fake_service):
    response = client.post(URL, json={"question": "   ¿Cuál fue la temperatura?   "}, headers=reader_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answer", "sql", "columns", "rows", "truncated", "trace"}
    assert body["rows"] == [{"promedio": 21.5}] and body["truncated"] is False
    assert fake_service.questions == ["¿Cuál fue la temperatura?"]  # trimmed


def test_rejected_sql_is_generic_for_regular_users_and_never_echoes_sql(client, reader_headers, fake_service):
    fake_service.error = SQLRejected("function", "la función PG_SLEEP no está permitida")
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "La consulta generada no está permitida."
    assert "PG_SLEEP" not in response.text.upper() and "SELECT" not in response.text.upper()


def test_rejected_sql_gives_admins_the_validator_reason(client, admin_reader_headers, fake_service):
    fake_service.error = SQLRejected("function", "la función PG_SLEEP no está permitida")
    response = client.post(URL, json=BODY, headers=admin_reader_headers)
    assert response.status_code == 422
    assert "PG_SLEEP" in response.json()["detail"]


def test_unanswerable_is_422_with_a_friendly_message(client, reader_headers, fake_service):
    fake_service.error = Unanswerable()
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 422 and "No puedo responder" in response.json()["detail"]


def test_llm_error_is_502_without_provider_detail(client, reader_headers, fake_service):
    fake_service.error = LLMError("HTTP 401 sk-secret")
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == 502
    assert "sk-secret" not in response.text


@pytest.mark.parametrize(("code", "status"), [("timeout", 504), ("database", 503), ("permission", 503), ("rejected", 503)])
def test_database_failures_are_mapped(client, reader_headers, fake_service, code, status):
    fake_service.error = QueryFailed(code)
    response = client.post(URL, json=BODY, headers=reader_headers)
    assert response.status_code == status
    assert code not in response.json()["detail"].lower() or code == "timeout"


def test_per_user_rate_limit_returns_429_with_retry_after(client, reader_headers, other_reader_headers, fake_service):
    from app.api.assistant import rate_limit

    for _ in range(rate_limit.LIMITS[0][1]):
        assert client.post(URL, json=BODY, headers=reader_headers).status_code == 200
    blocked = client.post(URL, json=BODY, headers=reader_headers)
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert client.post(URL, json=BODY, headers=other_reader_headers).status_code == 200  # per user, not global
    assert len(fake_service.questions) == rate_limit.LIMITS[0][1] + 1  # the blocked call never reached the model
