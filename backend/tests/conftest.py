import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.core.dependencies import (
    get_async_session,
    get_authed_session,
    get_db,
    get_system_session,
)
from app.core.security import create_access_token, hash_password
from app.core.emqx_presence import PresenceSnapshot, get_emqx_presence_client
from app.main import app


class UnavailablePresenceClient:
    async def get_snapshot(self) -> PresenceSnapshot:
        return PresenceSnapshot.unavailable()


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


@pytest.fixture(name="test_db_file")
def test_db_file_fixture(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture(name="test_db_url_sync")
def test_db_url_sync_fixture(test_db_file: Path) -> str:
    return f"sqlite:///{test_db_file}"


@pytest.fixture(name="test_db_url_async")
def test_db_url_async_fixture(test_db_file: Path) -> str:
    return f"sqlite+aiosqlite:///{test_db_file}"


@pytest.fixture(name="engine")
def engine_fixture(test_db_url_sync: str):
    engine = create_engine(
        test_db_url_sync,
        echo=False,
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture(name="session")
def session_fixture(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture(name="async_engine")
def async_engine_fixture(test_db_url_async: str):
    async_engine = create_async_engine(test_db_url_async, echo=False)
    try:
        yield async_engine
    finally:
        asyncio.run(async_engine.dispose())


@pytest_asyncio.fixture(name="async_session")
async def async_session_fixture(async_engine):
    async with AsyncSession(async_engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session: Session, async_engine):
    def get_session_override():
        return session

    async def get_async_session_override() -> AsyncGenerator[AsyncSession, None]:
        async with AsyncSession(async_engine, expire_on_commit=False) as async_sess:
            yield async_sess

    app.dependency_overrides[get_db] = get_session_override
    app.dependency_overrides[get_async_session] = get_async_session_override
    app.dependency_overrides[get_authed_session] = get_async_session_override
    app.dependency_overrides[get_system_session] = get_async_session_override
    app.dependency_overrides[get_emqx_presence_client] = UnavailablePresenceClient

    @asynccontextmanager
    async def no_lifespan(app_instance):
        yield

    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = no_lifespan

    try:
        with TestClient(app, base_url="http://localhost") as client:
            yield client
    finally:
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.clear()


@pytest.fixture(name="test_user")
def test_user_fixture(session: Session):
    user = User(
        email="test@example.com",
        username="testuser",
        password=hash_password("testpassword"),
        is_verified=True,
        permissions=[
            "user:read",
            "user:create",
            "user:update",
            "user:delete",
            "user:me",
            "user:password",
        ],
        first_name="Test",
        last_name="User",
        identification_number="TESTUSER123",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return user


@pytest.fixture(name="token")
def token_fixture(client: TestClient, test_user: User):
    response = client.post(
        "/api/auth/login",
        data={
            "username": test_user.username,
            "password": "testpassword",
        },
    )
    return response.json()["access_token"]
