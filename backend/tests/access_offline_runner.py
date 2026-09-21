"""Fail-closed entry point for explicitly selected backend access tests.

Selection is validated before the shared OAuth isolation guards run and before
pytest is imported. The runner never falls back to implicit root collection.
"""

from __future__ import annotations

from importlib import import_module
import pathlib
import sys
from typing import Any

import oauth_offline_runner as oauth_runner


_disable_dotenv_sources = oauth_runner._disable_dotenv_sources
_install_network_denial = oauth_runner._install_network_denial
_install_provider_doubles = oauth_runner._install_provider_doubles
_replace_process_environment = oauth_runner._replace_process_environment

_ALLOWED_TARGETS = (
    "tests/api/access/test_service.py",
    "tests/api/access/test_router.py",
    "tests/api/device/test_contextual_access_router.py",
    "tests/api/device/test_operation_service_slim.py",
    "tests/api/environment/test_invitation_service_access.py",
    "tests/api/environment/test_environment_creation_without_mercadopago.py",
    "tests/api/access/test_commission_free_sharing.py",
    "tests/api/test_mp_retirement_surface.py",
    "tests/core/mqtt/test_runtime_retirement.py",
    "tests/core/test_startup_bootstrap.py",
)
_SELECTION_ERROR = (
    "Access offline runner requires exact selections from its bounded access-test "
    "allowlist, optionally followed by nonempty pytest node selectors."
)
_EMAIL_SERVICE_CONSUMERS = (
    "app.api.access.router",
    "app.api.device.router",
    "app.api.device.billing_settings.router",
    "app.api.environment.invitation.router",
    "app.api.public.router",
    "app.api.auth.service",
)


def _selection_args(arguments: list[str]) -> list[str]:
    if not arguments:
        raise SystemExit(_SELECTION_ERROR)

    for argument in arguments:
        parts = argument.split("::")
        if parts[0] not in _ALLOWED_TARGETS or any(not part for part in parts):
            raise SystemExit(_SELECTION_ERROR)

    return arguments


def _read_module(name: str) -> Any:
    return import_module(name)


def _install_invitation_email_double() -> type[Any]:
    for consumer in _EMAIL_SERVICE_CONSUMERS:
        if consumer in sys.modules:
            raise RuntimeError(
                "Invitation email isolation must be installed before importing "
                f"{consumer}."
            )

    backend_source_root = str(pathlib.Path(__file__).resolve().parent.parent)
    sys.path[:] = [
        search_path
        for search_path in sys.path
        if search_path != backend_source_root
    ]
    sys.path.insert(0, backend_source_root)

    email_module = _read_module("app.core.email")

    class InvitationEmailDouble:
        invitation_calls: list[tuple[str, str, str, str]] = []

        def __init__(self, config: Any | None = None) -> None:
            del config

        async def send_invitation_email(
            self,
            email_to: str,
            environment_name: str,
            owner_email: str,
            invitation_id: str,
        ) -> None:
            self.invitation_calls.append(
                (email_to, environment_name, owner_email, invitation_id)
            )

        async def send_verification_email(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError(
                "Verification email is disabled by the access offline test runner."
            )

        async def send_password_reset_email(
            self, *_args: Any, **_kwargs: Any
        ) -> None:
            raise AssertionError(
                "Password-reset email is disabled by the access offline test runner."
            )

        async def send_contact_email(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError(
                "Contact email is disabled by the access offline test runner."
            )

        def __getattr__(self, name: str) -> Any:
            raise AssertionError(
                "Unsupported email method in the access offline test runner: "
                f"{name}."
            )

    email_module.EmailService = InvitationEmailDouble
    return InvitationEmailDouble


def _import_pytest() -> Any:
    return import_module("pytest")


def main() -> int:
    selections = _selection_args(sys.argv[1:])

    _replace_process_environment()
    _install_network_denial()
    _disable_dotenv_sources()
    _install_provider_doubles()
    _install_invitation_email_double()

    pytest = _import_pytest()
    return pytest.main(["-q", *selections])


if __name__ == "__main__":
    raise SystemExit(main())
