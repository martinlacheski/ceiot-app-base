import asyncio
import socket
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast

import pytest  # type: ignore[import-not-found]
from fastapi import HTTPException  # type: ignore[import-not-found]
from fastapi.responses import RedirectResponse  # type: ignore[import-not-found]
from fastapi.testclient import TestClient  # type: ignore[import-not-found]

_bootstrap_module = sys.modules.get("_oauth_offline_bootstrap")
if _bootstrap_module is None or not getattr(_bootstrap_module, "active", False):
    raise RuntimeError(
        "Run OAuth tests with: python tests/oauth_offline_runner.py"
    )
_bootstrap = cast(Any, _bootstrap_module)

from app.api.auth import router as auth_router  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.db import get_async_session  # noqa: E402
from app.main import app  # noqa: E402

_SYNTHETIC_SECRET = "-".join(("synthetic", "client", "secret"))
_OFFLINE_SECRET = "-".join(("offline", "client", "secret"))


@asynccontextmanager
async def _no_lifespan(_app):
    yield


@pytest.fixture
def oauth_client():
    async def offline_db_dependency():
        yield SimpleNamespace(name="offline-db-sentinel")

    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = _no_lifespan
    app.dependency_overrides[get_async_session] = offline_db_dependency
    client = TestClient(
        app,
        base_url="http://localhost",
        follow_redirects=False,
    )
    try:
        yield client
    finally:
        client.close()
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.clear()


def oauth_settings(**overrides):
    values = {
        "GOOGLE_OAUTH_ENABLED": False,
        "GOOGLE_CLIENT_ID": None,
        "GOOGLE_CLIENT_SECRET": None,
        "BACKEND_PUBLIC_BASE_URL": None,
        "BACKEND_HOST_URL": "http://localhost",
        "BACKEND_PORT": "18000",
        "VITE_FRONTEND_URL": "http://localhost",
        "VITE_FRONTEND_PORT": 15173,
        "ENVIRONMENT": "DEV",
        "REFRESH_TOKEN_EXPIRE_DAYS": 7,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_google_oauth_enabled_defaults_to_false():
    field = Settings.model_fields["GOOGLE_OAUTH_ENABLED"]
    assert field.default is False


@pytest.mark.parametrize(
    ("enabled", "client_id", "client_secret", "expected"),
    [
        (False, "legacy-id", "legacy-secret", False),
        (True, None, "secret", False),
        (True, "id", "   ", False),
        (True, " id ", " secret ", True),
    ],
)
def test_google_readiness_requires_opt_in_and_nonblank_credentials(
    monkeypatch, enabled, client_id, client_secret, expected
):
    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=enabled,
            GOOGLE_CLIENT_ID=client_id,
            GOOGLE_CLIENT_SECRET=client_secret,
        ),
    )

    result = auth_router._google_oauth_is_configured()

    assert result is expected
    assert type(result) is bool


def test_public_provider_payload_is_exact_boolean_and_leaks_no_credentials(monkeypatch):
    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID="synthetic-client-id",
            GOOGLE_CLIENT_SECRET=_SYNTHETIC_SECRET,
        ),
    )

    payload = asyncio.run(auth_router.auth_providers())

    assert payload == {"google": True}
    rendered = repr(payload)
    assert "synthetic-client-id" not in rendered
    assert _SYNTHETIC_SECRET not in rendered


@pytest.mark.parametrize(
    ("settings_overrides", "expected"),
    [
        ({"BACKEND_PUBLIC_BASE_URL": "https://public.example.test/root/"}, "https://public.example.test/root/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "http://localhost", "BACKEND_PORT": "18000"}, "http://localhost:18000/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "http://127.0.0.1", "BACKEND_PORT": "18000"}, "http://127.0.0.1:18000/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "http://[::1]", "BACKEND_PORT": "18000"}, "http://[::1]:18000/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "http://localhost:19000", "BACKEND_PORT": "18000"}, "http://localhost:19000/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "https://api.example.test/", "BACKEND_PORT": "18000"}, "https://api.example.test/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "http://localhost", "BACKEND_PORT": "80"}, "http://localhost/api/auth/google/callback"),
        ({"BACKEND_HOST_URL": "https://localhost", "BACKEND_PORT": "443"}, "https://localhost/api/auth/google/callback"),
    ],
)
def test_google_backend_callback_origin_policy(monkeypatch, settings_overrides, expected):
    monkeypatch.setattr(auth_router, "settings", oauth_settings(**settings_overrides))
    assert auth_router._google_callback_url() == expected


@pytest.mark.parametrize(
    ("settings_overrides", "expected_base"),
    [
        ({"VITE_FRONTEND_URL": "http://localhost", "VITE_FRONTEND_PORT": 15173}, "http://localhost:15173"),
        ({"VITE_FRONTEND_URL": "http://localhost:16000/", "VITE_FRONTEND_PORT": 15173}, "http://localhost:16000"),
        ({"VITE_FRONTEND_URL": "https://app.example.test/", "VITE_FRONTEND_PORT": 15173}, "https://app.example.test"),
        ({"VITE_FRONTEND_URL": "https://localhost", "VITE_FRONTEND_PORT": 443}, "https://localhost"),
    ],
)
def test_google_frontend_origin_policy(monkeypatch, settings_overrides, expected_base):
    monkeypatch.setattr(auth_router, "settings", oauth_settings(**settings_overrides))
    assert auth_router._google_success_url() == f"{expected_base}/auth/social-callback"
    assert auth_router._google_error_url() == f"{expected_base}/auth/login?error=social_auth_failed"


def test_google_success_url_preserves_safe_encoded_next(monkeypatch):
    monkeypatch.setattr(auth_router, "settings", oauth_settings())
    assert auth_router._google_success_url("/invitations/accept?id=inv-1") == (
        "http://localhost:15173/auth/social-callback"
        "?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    )
    assert auth_router._google_success_url("https://evil.example") == (
        "http://localhost:15173/auth/social-callback"
    )


def test_disabled_login_stops_before_sso(monkeypatch):
    called = False

    def forbidden_sso():
        nonlocal called
        called = True
        raise AssertionError("SSO must not be constructed")

    monkeypatch.setattr(auth_router, "settings", oauth_settings())
    monkeypatch.setattr(auth_router, "_google_sso_client", forbidden_sso, raising=False)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(auth_router.google_login())

    assert exc_info.value.status_code == 503
    assert "credential" not in str(exc_info.value.detail).lower()
    assert called is False


def test_disabled_callback_stops_before_sso_or_account_service(monkeypatch):
    account_service_called = False

    class ForbiddenAuthService:
        def __init__(self, *args, **kwargs):
            nonlocal account_service_called
            account_service_called = True
            raise AssertionError("Account service must not be constructed")

    monkeypatch.setattr(auth_router, "settings", oauth_settings())
    monkeypatch.setattr(auth_router, "AuthService", ForbiddenAuthService)
    monkeypatch.setattr(
        auth_router,
        "_google_sso_client",
        lambda: (_ for _ in ()).throw(AssertionError("SSO must not be constructed")),
        raising=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(auth_router.google_callback(SimpleNamespace(query_params={}), None))

    assert exc_info.value.status_code == 503
    assert account_service_called is False


def test_configured_login_uses_trimmed_credentials_and_preserves_next(monkeypatch):
    constructed = {}

    class StubGoogleSSO:
        def __init__(self, **kwargs):
            constructed.update(kwargs)

        async def get_login_redirect(self, state=None):
            return RedirectResponse(f"https://accounts.example.test?state={state}")

    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID=" client-id ",
            GOOGLE_CLIENT_SECRET=f" {_OFFLINE_SECRET} ",
        ),
    )
    monkeypatch.setattr(auth_router, "GoogleSSO", StubGoogleSSO)

    response = asyncio.run(auth_router.google_login("/safe?x=1"))

    assert response.headers["location"] == "https://accounts.example.test?state=/safe?x=1"
    assert constructed == {
        "client_id": "client-id",
        "client_secret": _OFFLINE_SECRET,
        "redirect_uri": "http://localhost:18000/api/auth/google/callback",
        "allow_insecure_http": True,
    }


def test_offline_bootstrap_blocks_controlled_inet_and_dns_probes():
    assert socket.socket is _bootstrap.offline_socket
    assert socket.getaddrinfo is not _bootstrap.real_getaddrinfo

    with pytest.raises(AssertionError, match="Outbound network is disabled"):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    with pytest.raises(AssertionError, match="Outbound network is disabled"):
        socket.getaddrinfo("probe.invalid", 443)

    left, right = socket.socketpair()
    left.close()
    right.close()


def test_global_social_providers_remain_offline_by_default():
    assert isinstance(auth_router.facebook_sso, _bootstrap.offline_provider_class)
    with pytest.raises(AssertionError, match="provider method was not stubbed"):
        asyncio.run(auth_router.facebook_sso.get_login_redirect())


def test_http_provider_payload_is_exact_boolean_and_leaks_no_credentials(
    monkeypatch, oauth_client, capsys, caplog
):
    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID=_bootstrap.synthetic_google_client_id,
            GOOGLE_CLIENT_SECRET=_bootstrap.synthetic_google_client_secret,
        ),
    )

    response = oauth_client.get("/api/auth/providers")

    assert response.status_code == 200
    assert response.json() == {"google": True}
    captured = capsys.readouterr()
    rendered = f"{response.json()!r} {captured.out} {captured.err} {caplog.text}"
    assert _bootstrap.synthetic_google_client_id not in rendered
    assert _bootstrap.synthetic_google_client_secret not in rendered


@pytest.mark.parametrize(
    "path",
    [
        "/api/auth/google/login",
        "/api/auth/google/callback?code=offline-code",
    ],
)
def test_http_disabled_google_routes_return_503_before_sso_or_accounts(
    monkeypatch, oauth_client, path
):
    calls = []

    class ForbiddenAuthService:
        def __init__(self, *_args, **_kwargs):
            calls.append("auth-service")
            raise AssertionError("Account service must not be constructed")

    monkeypatch.setattr(auth_router, "settings", oauth_settings())
    monkeypatch.setattr(auth_router, "AuthService", ForbiddenAuthService)
    monkeypatch.setattr(
        auth_router,
        "_google_sso_client",
        lambda: calls.append("sso") or pytest.fail("SSO must not be constructed"),
    )

    response = oauth_client.get(path)

    assert response.status_code == 503
    assert response.json() == {"detail": "Google sign-in is not available."}
    assert calls == []


def test_http_configured_login_uses_only_narrow_offline_redirect_stub(
    monkeypatch, oauth_client
):
    calls = []

    class RedirectOnlySSO:
        async def get_login_redirect(self, state=None):
            calls.append(state)
            return RedirectResponse("https://provider.invalid/offline-login", status_code=307)

    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID="offline-id",
            GOOGLE_CLIENT_SECRET=_OFFLINE_SECRET,
        ),
    )
    monkeypatch.setattr(auth_router, "_google_sso_client", RedirectOnlySSO)

    response = oauth_client.get(
        "/api/auth/google/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    )

    assert response.status_code == 307
    assert response.headers["location"] == "https://provider.invalid/offline-login"
    assert calls == ["/invitations/accept?id=inv-1"]


def test_http_configured_callback_redirects_with_bounded_next_and_mocked_account_flow(
    monkeypatch, oauth_client
):
    calls = []
    fake_user = SimpleNamespace(id="offline-user", username="offline-user")

    class CallbackSSO:
        async def verify_and_process(self, request):
            calls.append(("verify", request.query_params.get("code")))
            return SimpleNamespace(
                email="oauth-user@example.invalid",
                first_name="OAuth",
                last_name="User",
            )

    class StubRepository:
        def __init__(self, db):
            calls.append(("repository", db.name))

    class StubAuthService:
        def __init__(self, repository):
            calls.append(("service", type(repository).__name__))

        async def get_or_create_social_user(self, **profile):
            calls.append(("profile", profile))
            return fake_user

        def renew_token(self, user):
            calls.append(("tokens", user is fake_user))
            return {"refresh_token": "offline-refresh-token"}

    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID="offline-id",
            GOOGLE_CLIENT_SECRET=_OFFLINE_SECRET,
        ),
    )
    monkeypatch.setattr(auth_router, "_google_sso_client", CallbackSSO)
    monkeypatch.setattr(auth_router, "UserRepository", StubRepository)
    monkeypatch.setattr(auth_router, "AuthService", StubAuthService)

    response = oauth_client.get(
        "/api/auth/google/callback?code=offline-code&state="
        "%2Finvitations%2Faccept%3Fid%3Dinv-1"
    )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "http://localhost:15173/auth/social-callback"
        "?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    )
    assert "refresh_token=offline-refresh-token" in response.headers["set-cookie"]
    assert calls == [
        ("repository", "offline-db-sentinel"),
        ("service", "StubRepository"),
        ("verify", "offline-code"),
        (
            "profile",
            {
                "email": "oauth-user@example.invalid",
                "first_name": "OAuth",
                "last_name": "User",
            },
        ),
        ("tokens", True),
    ]


def test_http_configured_callback_failure_is_bounded_and_does_not_issue_tokens(
    monkeypatch, oauth_client
):
    calls = []

    class FailingSSO:
        async def verify_and_process(self, _request):
            calls.append("verify")
            raise AssertionError("Synthetic provider rejection")

    class StubRepository:
        def __init__(self, db):
            calls.append(("repository", db.name))

    class StubAuthService:
        def __init__(self, _repository):
            calls.append("service")

        async def get_or_create_social_user(self, **_profile):
            pytest.fail("No account operation is allowed after provider failure")

        def renew_token(self, _user):
            pytest.fail("No token operation is allowed after provider failure")

    monkeypatch.setattr(
        auth_router,
        "settings",
        oauth_settings(
            GOOGLE_OAUTH_ENABLED=True,
            GOOGLE_CLIENT_ID="offline-id",
            GOOGLE_CLIENT_SECRET=_OFFLINE_SECRET,
        ),
    )
    monkeypatch.setattr(auth_router, "_google_sso_client", FailingSSO)
    monkeypatch.setattr(auth_router, "UserRepository", StubRepository)
    monkeypatch.setattr(auth_router, "AuthService", StubAuthService)

    response = oauth_client.get("/api/auth/google/callback?code=offline-code")

    assert response.status_code == 303
    assert response.headers["location"] == (
        "http://localhost:15173/auth/login?error=social_auth_failed"
    )
    assert "set-cookie" not in response.headers
    assert calls == [
        ("repository", "offline-db-sentinel"),
        "service",
        "verify",
    ]
