"""Fail-closed entry point for the backend OAuth test group.

This module prepares a synthetic process environment and offline provider/network
boundaries before pytest can import the application's root conftest.
"""

from __future__ import annotations

import inspect
import os
import socket
import sys
import types
from importlib import import_module
from importlib.metadata import version
from typing import Any, cast


_DENIAL_MESSAGE = "Outbound network is disabled by the OAuth offline test runner."
_SYNTHETIC_TMP = os.path.join(os.sep, "tmp")
_SYNTHETIC_ENV = {
    "HOME": os.path.join(_SYNTHETIC_TMP, "oauth-offline-home"),
    "TMPDIR": _SYNTHETIC_TMP,
    "BACKEND_HOST_URL": "http://localhost",
    "BACKEND_PORT": "18000",
    "BACKEND_PUBLIC_BASE_URL": "http://localhost:18000",
    "DATABASE_URL": "sqlite:////tmp/oauth-offline.sqlite",
    "ALEMBIC_DATABASE_URL": "sqlite:////tmp/oauth-offline.sqlite",
    "JWT_SECRET_KEY": "offline-jwt-signing-key",
    "JWT_ALGORITHM": "HS256",
    "JWT_EXPIRES_MINUTES": "15",
    "REFRESH_TOKEN_EXPIRE_DAYS": "7",
    "BACKEND_CORS_ORIGINS": "[]",
    "BACKEND_TRUSTED_HOSTS": '["localhost", "testserver"]',
    "PROJECT_NAME": "OAuth Offline Tests",
    "ENVIRONMENT": "TEST",
    "MAX_UPLOAD_MB": "1",
    "MQTT_CLIENT_ID": "oauth-offline-tests",
    "MQTT_TOPIC_DEVICE_SUB": "offline/devices",
    "EMQX_HOST": "mqtt.invalid",
    "EMQX_PORT": "1883",
    "EMQX_USER": "offline-mqtt-user",
    "EMQX_PASSWORD": "offline-mqtt-password",
    "MAIL_TRANSPORT": "mailpit",
    "MAIL_USERNAME": "",
    "MAIL_PASSWORD": "",
    "MAIL_FROM": "oauth-tests@example.invalid",
    "MAIL_PORT": "1025",
    "MAIL_SERVER": "mail.invalid",
    "MAIL_STARTTLS": "false",
    "MAIL_SSL_TLS": "false",
    "MAIL_USE_CREDENTIALS": "false",
    "MAIL_VALIDATE_CERTS": "false",
    "VITE_FRONTEND_URL": "http://localhost",
    "VITE_FRONTEND_PORT": "15173",
    "GOOGLE_OAUTH_ENABLED": "false",
    "GOOGLE_CLIENT_ID": "offline-google-client-id",
    "GOOGLE_CLIENT_SECRET": "offline-google-client-secret",
    "FACEBOOK_CLIENT_ID": "offline-facebook-client-id",
    "FACEBOOK_CLIENT_SECRET": "offline-facebook-client-secret",
}


def _replace_process_environment() -> None:
    os.environ.clear()
    os.environ.update(_SYNTHETIC_ENV)


def _install_network_denial() -> tuple[Any, Any]:
    real_socket = socket.socket
    real_getaddrinfo = socket.getaddrinfo

    class OfflineSocket(real_socket):  # type: ignore[misc, valid-type]
        def __init__(
            self,
            family: int = socket.AF_INET,
            type: int = socket.SOCK_STREAM,
            proto: int = 0,
            fileno: int | None = None,
        ) -> None:
            if family != socket.AF_UNIX:
                raise AssertionError(_DENIAL_MESSAGE)
            if fileno is None:
                super().__init__(family, type, proto)
            else:
                super().__init__(family, type, proto, fileno)

    def deny_network(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError(_DENIAL_MESSAGE)

    socket.socket = OfflineSocket
    socket.create_connection = deny_network  # type: ignore[assignment]
    socket.getaddrinfo = deny_network  # type: ignore[assignment]
    socket.gethostbyname = deny_network  # type: ignore[assignment]
    socket.gethostbyname_ex = deny_network  # type: ignore[assignment]
    socket.gethostbyaddr = deny_network  # type: ignore[assignment]
    return real_socket, real_getaddrinfo


def _disable_dotenv_sources() -> None:
    if version("pydantic-settings") != "2.11.0":
        raise RuntimeError("Unsupported pydantic-settings version for offline OAuth tests.")

    settings_module = import_module("pydantic_settings")
    sources_module = import_module("pydantic_settings.sources")
    BaseSettings = settings_module.BaseSettings
    DotEnvSettingsSource = sources_module.DotEnvSettingsSource

    expected = {
        "settings_cls",
        "init_settings",
        "env_settings",
        "dotenv_settings",
        "file_secret_settings",
    }
    source_parameters = set(
        inspect.signature(BaseSettings.settings_customise_sources).parameters
    )
    reader_parameters = set(
        inspect.signature(DotEnvSettingsSource._read_env_files).parameters
    )
    if (
        source_parameters != expected
        or reader_parameters != {"self"}
        or not callable(DotEnvSettingsSource.__call__)
    ):
        raise RuntimeError("Unsupported settings source API for offline OAuth tests.")

    @classmethod
    def offline_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        del cls, settings_cls, dotenv_settings, file_secret_settings
        return init_settings, env_settings

    def empty_dotenv_files(self) -> dict[str, Any]:
        del self
        return {}

    def reject_dotenv_call(self) -> dict[str, Any]:
        del self
        raise RuntimeError("Dotenv reads are disabled by the OAuth offline test runner.")

    DotEnvSettingsSource._read_env_files = empty_dotenv_files
    BaseSettings.settings_customise_sources = offline_sources  # type: ignore[method-assign]
    DotEnvSettingsSource.__call__ = reject_dotenv_call  # type: ignore[method-assign]

    dotenv = cast(Any, import_module("dotenv"))
    dotenv.load_dotenv = lambda *_args, **_kwargs: False


class OfflineProvider:
    """Universal provider double used unless a test installs a narrower stub."""

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        pass

    async def get_login_redirect(self, *_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("Offline OAuth provider method was not stubbed.")

    async def verify_and_process(self, *_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("Offline OAuth provider method was not stubbed.")


def _install_provider_doubles() -> None:
    facebook = cast(Any, import_module("fastapi_sso.sso.facebook"))
    google = cast(Any, import_module("fastapi_sso.sso.google"))

    google.GoogleSSO = OfflineProvider
    facebook.FacebookSSO = OfflineProvider


def _selection_args(arguments: list[str]) -> list[str]:
    target = "tests/test_google_oauth.py"
    node_prefix = f"{target}::"

    if not arguments:
        return [target]
    if all(
        argument == target
        or (argument.startswith(node_prefix) and bool(argument[len(node_prefix) :]))
        for argument in arguments
    ):
        return arguments
    raise SystemExit(
        "OAuth offline runner accepts only tests/test_google_oauth.py node selections."
    )


def main() -> int:
    _replace_process_environment()
    real_socket, real_getaddrinfo = _install_network_denial()
    _disable_dotenv_sources()
    _install_provider_doubles()

    state = types.ModuleType("_oauth_offline_bootstrap")
    state.__dict__.update(
        {
            "active": True,
            "denial_message": _DENIAL_MESSAGE,
            "offline_socket": socket.socket,
            "offline_provider_class": OfflineProvider,
            "real_socket": real_socket,
            "real_getaddrinfo": real_getaddrinfo,
            "synthetic_google_client_id": _SYNTHETIC_ENV["GOOGLE_CLIENT_ID"],
            "synthetic_google_client_secret": _SYNTHETIC_ENV[
                "GOOGLE_CLIENT_SECRET"
            ],
        }
    )
    sys.modules[state.__name__] = state

    pytest = import_module("pytest")

    return pytest.main(["-q", *_selection_args(sys.argv[1:])])


if __name__ == "__main__":
    raise SystemExit(main())
