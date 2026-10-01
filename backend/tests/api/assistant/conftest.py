"""Fixtures for the assistant API: users with/without telemetry:read and a fake service."""

import pytest

from app.api.assistant import rate_limit
from app.api.assistant.router import get_assistant_service
from app.api.assistant.service import AssistantAnswer
from app.api.auth.models import User
from app.core.security import create_access_token, hash_password
from app.main import app


def _headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def _user(session, name, *, permissions, admin=False):
    user = User(email=f"{name}@example.com", username=name, password=hash_password("x"), is_verified=True,
                is_admin=admin, permissions=permissions, first_name="N", last_name="L",
                identification_number=name.upper())
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="reader")
def reader_fixture(session):
    return _user(session, "reader", permissions=["telemetry:read"])


@pytest.fixture(name="reader_headers")
def reader_headers_fixture(reader):
    return _headers(reader)


@pytest.fixture(name="other_reader_headers")
def other_reader_headers_fixture(session):
    return _headers(_user(session, "other-reader", permissions=["telemetry:read"]))


@pytest.fixture(name="no_permission_headers")
def no_permission_headers_fixture(session):
    return _headers(_user(session, "nobody", permissions=["user:me"]))


@pytest.fixture(name="admin_reader_headers")
def admin_reader_headers_fixture(session):
    return _headers(_user(session, "admin-reader", permissions=["telemetry:read"], admin=True))


@pytest.fixture(autouse=True)
def _clean_rate_limit():
    rate_limit.reset_memory_state()
    yield
    rate_limit.reset_memory_state()


class FakeService:
    def __init__(self, error=None):
        self.error = error
        self.questions: list[str] = []

    async def ask(self, question):
        self.questions.append(question)
        if self.error:
            raise self.error
        return AssistantAnswer(
            answer="La temperatura promedio fue 21,5 °C.",
            sql="SELECT AVG(value) AS promedio FROM ai_read.telemetry LIMIT 1",
            columns=["promedio"], rows=[{"promedio": 21.5}], truncated=False, trace=["esquema-database"],
        )


@pytest.fixture(name="fake_service")
def fake_service_fixture(client):
    service = FakeService()
    app.dependency_overrides[get_assistant_service] = lambda: service
    yield service
    app.dependency_overrides.pop(get_assistant_service, None)
