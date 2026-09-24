"""last_login_at / last_seen_at: recorded on login and (throttled) on authenticated requests."""

import time
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, select

from app.api.auth import router as auth_router
from app.api.auth.models import User
from app.api.auth.repository import UserRepository
from app.core.security import create_access_token

LOGIN = "/api/auth/login"
ME = "/api/auth/me"


def _headers(user: User) -> dict[str, str]:
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def _reload(session: Session, user: User) -> User:
    session.expire_all()
    return session.exec(select(User).where(User.id == user.id)).one()


def _login(client: TestClient, user: User, password: str = "testpassword"):
    return client.post(LOGIN, data={"username": user.username, "password": password})


def test_successful_login_sets_last_login_and_last_seen(
    client: TestClient, session: Session, test_user: User
):
    assert test_user.last_login_at is None and test_user.last_seen_at is None
    before = datetime.now()

    response = _login(client, test_user)

    assert response.status_code == 200
    stored = _reload(session, test_user)
    assert stored.last_login_at is not None and stored.last_login_at >= before
    assert stored.last_seen_at == stored.last_login_at
    assert stored.updated_at is None  # la actividad nunca toca "actualizado"
    body = response.json()["user"]
    assert body["lastLoginAt"] is not None
    assert body["lastSeenAt"] is not None


def test_failed_login_writes_nothing(client: TestClient, session: Session, test_user: User):
    assert _login(client, test_user, password="wrong").status_code == 401

    stored = _reload(session, test_user)
    assert stored.last_login_at is None and stored.last_seen_at is None


def test_unverified_login_writes_nothing(client: TestClient, session: Session, test_user: User):
    test_user.is_verified = False
    session.add(test_user)
    session.commit()

    assert _login(client, test_user).status_code == 403

    stored = _reload(session, test_user)
    assert stored.last_login_at is None and stored.last_seen_at is None


def test_touch_failure_never_breaks_login(
    client: TestClient, session: Session, test_user: User, monkeypatch, caplog
):
    async def boom(self, user_id, now):
        raise RuntimeError("db down")

    monkeypatch.setattr(UserRepository, "touch_login", boom)

    with caplog.at_level("WARNING"):
        response = _login(client, test_user)

    assert response.status_code == 200
    assert "access_token" in response.json()
    assert any("last login" in record.getMessage().lower() for record in caplog.records)


@pytest.mark.parametrize("provider", ["google", "facebook"])
def test_sso_callback_sets_last_login(
    client: TestClient, session: Session, test_user: User, monkeypatch, provider
):
    async def fake_verify(request):
        return SimpleNamespace(email=test_user.email, first_name="T", last_name="U")

    if provider == "google":
        monkeypatch.setattr(auth_router, "_google_oauth_is_configured", lambda: True)
        monkeypatch.setattr(
            auth_router,
            "_google_sso_client",
            lambda: SimpleNamespace(verify_and_process=fake_verify),
        )
    else:
        monkeypatch.setattr(auth_router.facebook_sso, "verify_and_process", fake_verify)

    response = client.get(f"/api/auth/{provider}/callback", follow_redirects=False)

    assert response.status_code == 303
    assert "error=social_auth_failed" not in response.headers["location"]
    stored = _reload(session, test_user)
    assert stored.last_login_at is not None
    assert stored.last_seen_at == stored.last_login_at


def test_new_sso_user_gets_last_login(client: TestClient, session: Session, monkeypatch):
    async def fake_verify(request):
        return SimpleNamespace(email="brand.new@example.com", first_name="B", last_name="N")

    monkeypatch.setattr(auth_router, "_google_oauth_is_configured", lambda: True)
    monkeypatch.setattr(
        auth_router,
        "_google_sso_client",
        lambda: SimpleNamespace(verify_and_process=fake_verify),
    )

    client.get("/api/auth/google/callback", follow_redirects=False)

    created = session.exec(select(User).where(User.email == "brand.new@example.com")).one()
    assert created.last_login_at is not None and created.last_seen_at is not None


def _count_user_updates(async_engine):
    statements: list[str] = []

    def before_cursor_execute(conn, cursor, statement, *args):
        if statement.lstrip().upper().replace('"', "").startswith("UPDATE USER "):
            statements.append(statement)

    sync_engine = async_engine.sync_engine
    event.listen(sync_engine, "before_cursor_execute", before_cursor_execute)
    return statements, lambda: event.remove(
        sync_engine, "before_cursor_execute", before_cursor_execute
    )


def test_authenticated_requests_touch_last_seen_at_most_every_15_minutes(
    client: TestClient, session: Session, async_engine, test_user: User
):
    statements, stop = _count_user_updates(async_engine)
    try:
        assert client.get(ME, headers=_headers(test_user)).status_code == 200
        first = _reload(session, test_user).last_seen_at
        assert first is not None
        assert len(statements) == 1

        # Dentro de la ventana: no se escribe nada.
        assert client.get(ME, headers=_headers(test_user)).status_code == 200
        assert len(statements) == 1
        assert _reload(session, test_user).last_seen_at == first

        # Fuera de la ventana: se vuelve a escribir.
        test_user_row = _reload(session, test_user)
        test_user_row.last_seen_at = datetime.now() - timedelta(minutes=16)
        session.add(test_user_row)
        session.commit()
        stale = _reload(session, test_user).last_seen_at
        updated_before = _reload(session, test_user).updated_at  # el ORM lo fija arriba
        assert client.get(ME, headers=_headers(test_user)).status_code == 200
        assert len(statements) == 2
        assert _reload(session, test_user).last_seen_at > stale
        assert _reload(session, test_user).updated_at == updated_before
    finally:
        stop()


def test_touch_seen_failure_never_breaks_the_request(
    client: TestClient, test_user: User, monkeypatch, caplog
):
    async def boom(self, user_id, now, min_interval=timedelta(minutes=15)):
        raise RuntimeError("db down")

    monkeypatch.setattr(UserRepository, "touch_seen", boom)

    with caplog.at_level("WARNING"):
        response = client.get(ME, headers=_headers(test_user))

    assert response.status_code == 200
    assert any("last seen" in record.getMessage().lower() for record in caplog.records)


@pytest.mark.asyncio
async def test_touch_seen_keeps_the_loaded_user_usable_and_clean(async_session, session, test_user):
    """The returned user shows the new value, is not expired and is not left dirty."""
    from sqlalchemy import inspect as sa_inspect

    from app.core.dependencies import get_current_user

    token, _ = create_access_token({"id": str(test_user.id)})

    user = await get_current_user(token, async_session)

    assert user.last_seen_at is not None
    assert user.username == test_user.username  # sin error de atributo expirado
    assert not sa_inspect(user).modified  # un commit posterior no debe tocar updated_at
    await async_session.commit()
    assert _reload(session, test_user).updated_at is None


@pytest.mark.asyncio
async def test_repository_touches_do_not_bump_updated_at(async_session, session, test_user):
    stamp = datetime(2026, 1, 2, 3, 4, 5)
    test_user.updated_at = stamp
    session.add(test_user)
    session.commit()
    repo = UserRepository(async_session)
    now = datetime(2026, 9, 20, 12, 0, 0)

    await repo.touch_login(test_user.id, now)
    assert _reload(session, test_user).updated_at == stamp
    assert _reload(session, test_user).last_login_at == now

    assert await repo.touch_seen(test_user.id, now + timedelta(minutes=20)) is True
    assert _reload(session, test_user).updated_at == stamp
    assert _reload(session, test_user).last_seen_at == now + timedelta(minutes=20)


@pytest.mark.asyncio
async def test_repository_touches_keep_null_updated_at(async_session, session, test_user):
    repo = UserRepository(async_session)
    now = datetime(2026, 9, 20, 12, 0, 0)

    await repo.touch_login(test_user.id, now)
    await repo.touch_seen(test_user.id, now + timedelta(minutes=30))

    assert _reload(session, test_user).updated_at is None


@pytest.mark.asyncio
async def test_touch_seen_is_a_conditional_update(async_session, session, test_user):
    repo = UserRepository(async_session)
    now = datetime(2026, 9, 20, 12, 0, 0)

    assert await repo.touch_seen(test_user.id, now) is True  # NULL -> se escribe
    assert await repo.touch_seen(test_user.id, now + timedelta(minutes=14)) is False
    assert _reload(session, test_user).last_seen_at == now
    assert await repo.touch_seen(test_user.id, now + timedelta(minutes=15)) is True
    assert _reload(session, test_user).last_seen_at == now + timedelta(minutes=15)


def test_users_created_in_the_same_process_have_distinct_created_at(session: Session):
    first = User(email="a@example.com", username="a", password="x")
    time.sleep(0.01)
    second = User(email="b@example.com", username="b", password="x")

    assert first.created_at != second.created_at
    assert second.created_at > first.created_at


def test_activity_fields_are_not_client_writable():
    from app.api.auth.models import UserCreate, UserUpdate

    for dto in (UserCreate, UserUpdate):
        assert "last_login_at" not in dto.model_fields
        assert "last_seen_at" not in dto.model_fields


@pytest.mark.parametrize(
    ("field", "column"), [("lastLoginAt", "last_login_at"), ("lastSeenAt", "last_seen_at")]
)
@pytest.mark.asyncio
async def test_user_list_sorts_by_activity_with_nulls_last(monkeypatch, field, column):
    queries = []

    async def capture_query(db, model, base_query, page, per_page):
        queries.append(str(base_query))
        return {"items": [], "total": 0, "pages": 0, "page": page, "per_page": per_page}

    monkeypatch.setattr("app.services.pagination.paginate_query_async", capture_query)
    repo = UserRepository(SimpleNamespace())

    await repo.get_all(sort=((field, "asc"),))
    await repo.get_all(sort=((field, "desc"),))

    assert f'"user".{column} ASC NULLS LAST, "user".id ASC' in queries[0]
    assert f'"user".{column} DESC NULLS LAST, "user".id DESC' in queries[1]


def test_user_list_endpoint_accepts_activity_sorts(client: TestClient, test_user: User):
    for field in ("lastLoginAt", "lastSeenAt"):
        response = client.get(
            f"/api/auth/?sort={field}:desc", headers=_headers(test_user)
        )
        assert response.status_code == 200, response.text
