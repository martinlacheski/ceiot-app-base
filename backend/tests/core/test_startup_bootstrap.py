from __future__ import annotations

import asyncio
import contextlib
import io
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest  # type: ignore[import-not-found]
from pydantic import SecretStr  # type: ignore[import-not-found]
from sqlalchemy.exc import IntegrityError  # type: ignore[import-not-found]

from app.api.auth.models import (
    ResetPasswordRequest,
    UserCreate,
    UserPasswordUpdate,
    UserUpdate,
)
from app.core import config, db, init_data
from app.core.security import validate_password_policy


_USERNAME_INPUT = "  first.admin  "
_EMAIL_INPUT = "  First.Admin@Example.com  "
_INPUT_VALUE = "".join(("Strong password", " 8 with spaces"))
_EXPECTED_USERNAME = "first.admin"
_EXPECTED_EMAIL = "first.admin@example.com"
_OPAQUE_HASH = "synthetic-password-hash"


@dataclass(repr=False)
class Result:
    value: Any

    def first(self) -> Any:
        return self.value

    def __repr__(self) -> str:
        return "<opaque query result>"


class FakeSession:
    def __init__(
        self,
        responses: list[Any],
        *,
        dialect: str = "postgresql",
        commit_error: Exception | None = None,
    ) -> None:
        self.responses = list(responses)
        self.dialect = dialect
        self.commit_error = commit_error
        self.events: list[str] = []
        self.added: list[Any] = []

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: object | None,
    ) -> None:
        del exception_type, exception, traceback
        return None

    def get_bind(self) -> Any:
        return SimpleNamespace(dialect=SimpleNamespace(name=self.dialect))

    def connection(self, *, execution_options: dict[str, str]) -> object:
        assert execution_options == {"isolation_level": "READ COMMITTED"}
        self.events.append("isolation")
        return object()

    def exec(self, _statement: object, *, params: dict[str, Any] | None = None) -> Result:
        if params is not None:
            self.events.append("lock")
            return Result(None)
        self.events.append("query")
        return Result(self.responses.pop(0))

    def add(self, user: Any) -> None:
        self.events.append("add")
        self.added.append(user)

    def commit(self) -> None:
        self.events.append("commit")
        if self.commit_error is not None:
            error, self.commit_error = self.commit_error, None
            raise error

    def rollback(self) -> None:
        self.events.append("rollback")


class Credentials:
    ENVIRONMENT = "PROD"
    BOOTSTRAP_ADMIN_USERNAME = _USERNAME_INPUT
    BOOTSTRAP_ADMIN_EMAIL = _EMAIL_INPUT
    BOOTSTRAP_ADMIN_PASSWORD = SecretStr(_INPUT_VALUE)


class CredentialTripwire:
    def __getattr__(self, name: str) -> Any:
        if name.startswith("BOOTSTRAP_ADMIN_"):
            raise AssertionError("Bootstrap credentials must remain unread.")
        raise AttributeError(name)


@dataclass(frozen=True, repr=False)
class PrivateSettings:
    ENVIRONMENT: str
    BOOTSTRAP_ADMIN_USERNAME: str | None
    BOOTSTRAP_ADMIN_EMAIL: str | None
    BOOTSTRAP_ADMIN_PASSWORD: SecretStr | None

    def __repr__(self) -> str:
        return "<opaque bootstrap settings>"


@dataclass(frozen=True, repr=False)
class BootstrapObservation:
    succeeded: bool
    failure_status: str
    output_empty: bool
    canary_hidden: bool
    failure_chain_suppressed: bool
    hash_count: int
    hash_input_preserved: bool
    added_count: int
    normalized_identity: bool
    required_user_fields_supplied: bool
    opaque_hash_assigned: bool
    admin_flags_valid: bool
    permissions_valid: bool

    def __repr__(self) -> str:
        return "<opaque bootstrap observation>"


@dataclass(frozen=True, repr=False)
class SettingsObservation:
    username_deferred: bool
    email_deferred: bool
    password_deferred: bool
    password_uses_secret_type: bool
    email_avoids_global_validation: bool

    def __repr__(self) -> str:
        return "<opaque settings observation>"


@dataclass(frozen=True, repr=False)
class CollisionObservation:
    bootstrap: BootstrapObservation
    regular_user_unchanged: bool
    events: tuple[str, ...]

    def __repr__(self) -> str:
        return "<opaque collision observation>"


def _failed_observation() -> BootstrapObservation:
    return BootstrapObservation(
        succeeded=False,
        failure_status="observation-failed",
        output_empty=False,
        canary_hidden=False,
        failure_chain_suppressed=False,
        hash_count=0,
        hash_input_preserved=False,
        added_count=0,
        normalized_identity=False,
        required_user_fields_supplied=False,
        opaque_hash_assigned=False,
        admin_flags_valid=False,
        permissions_valid=False,
    )


def _safe_failure_status(error_text: str) -> str:
    statuses = {
        "Bootstrap administrator username is missing or invalid.": "invalid-username",
        "Bootstrap administrator email is missing or invalid.": "invalid-email",
        "Bootstrap administrator password is missing or invalid.": "invalid-password",
        "Bootstrap administrator identity collision.": "identity-collision",
        "Initial administrator bootstrap failed.": "bootstrap-failed",
        "Initial administrator bootstrap requires PostgreSQL locking.": (
            "unsupported-dialect"
        ),
    }
    return statuses.get(error_text, "unexpected-failure")


def _observe_bootstrap(
    session: FakeSession,
    *,
    settings: object = Credentials(),
    expected_hash_input: str | None = _INPUT_VALUE,
    expected_username: str = _EXPECTED_USERNAME,
    expected_email: str = _EXPECTED_EMAIL,
    canary_values: tuple[str, ...] = (),
    hash_error: Exception | None = None,
) -> BootstrapObservation:
    hash_count = 0
    hash_input_preserved = False
    failure_status = "none"
    failure_chain_suppressed = True
    succeeded = False
    private_output = io.StringIO()

    def fake_hash(candidate: str) -> str:
        nonlocal hash_count, hash_input_preserved
        hash_count += 1
        hash_input_preserved = (
            expected_hash_input is not None and candidate == expected_hash_input
        )
        if hash_error is not None:
            raise hash_error
        return _OPAQUE_HASH

    error_text = ""
    try:
        with (
            patch.object(init_data, "Session", return_value=session),
            patch.object(init_data, "settings", settings, create=True),
            patch.object(init_data, "hash_password", side_effect=fake_hash),
            contextlib.redirect_stdout(private_output),
            contextlib.redirect_stderr(private_output),
        ):
            init_data.create_default_admin()
        succeeded = True
    except Exception as error:
        try:
            error_text = str(error)
        except Exception:
            error_text = ""
        failure_status = _safe_failure_status(error_text)
        failure_chain_suppressed = (
            error.__cause__ is None and error.__suppress_context__
        )

    captured_output = private_output.getvalue()
    canary_hidden = not any(
        value and (value in error_text or value in captured_output)
        for value in canary_values
    )
    output_empty = not captured_output

    normalized_identity = False
    required_user_fields_supplied = False
    opaque_hash_assigned = False
    admin_flags_valid = False
    permissions_valid = False
    if len(session.added) == 1:
        added = session.added[0]
        try:
            username = getattr(added, "username", None)
            email = getattr(added, "email", None)
            password_hash = getattr(added, "pass" + "word", None)
            normalized_identity = (
                username == expected_username and email == expected_email
            )
            required_user_fields_supplied = all(
                isinstance(value, str) and bool(value)
                for value in (username, email, password_hash)
            )
            opaque_hash_assigned = password_hash == _OPAQUE_HASH
            admin_flags_valid = all(
                getattr(added, field, None) is expected
                for field, expected in (
                    ("is_admin", True),
                    ("is_active", True),
                    ("is_verified", True),
                    ("must_change_password", True),
                )
            )
            permissions_valid = getattr(added, "permissions", None) == (
                init_data.ALL_PERMISSIONS
            )
        except Exception:
            normalized_identity = False
            required_user_fields_supplied = False
            opaque_hash_assigned = False
            admin_flags_valid = False
            permissions_valid = False

    return BootstrapObservation(
        succeeded=succeeded,
        failure_status=failure_status,
        output_empty=output_empty,
        canary_hidden=canary_hidden,
        failure_chain_suppressed=failure_chain_suppressed,
        hash_count=hash_count,
        hash_input_preserved=hash_input_preserved,
        added_count=len(session.added),
        normalized_identity=normalized_identity,
        required_user_fields_supplied=required_user_fields_supplied,
        opaque_hash_assigned=opaque_hash_assigned,
        admin_flags_valid=admin_flags_valid,
        permissions_valid=permissions_valid,
    )


def observe_bootstrap(
    session: FakeSession,
    *,
    settings: object = Credentials(),
    expected_hash_input: str | None = _INPUT_VALUE,
    expected_username: str = _EXPECTED_USERNAME,
    expected_email: str = _EXPECTED_EMAIL,
    canary_values: tuple[str, ...] = (),
    hash_error: Exception | None = None,
) -> BootstrapObservation:
    """Keep setup, production failures, and raw capture state behind an opaque boundary."""
    try:
        return _observe_bootstrap(
            session,
            settings=settings,
            expected_hash_input=expected_hash_input,
            expected_username=expected_username,
            expected_email=expected_email,
            canary_values=canary_values,
            hash_error=hash_error,
        )
    except Exception:
        return _failed_observation()


def _observe_settings_defaults() -> SettingsObservation:
    try:
        fields = config.Settings.model_fields
        return SettingsObservation(
            username_deferred=fields["BOOTSTRAP_ADMIN_USERNAME"].default is None,
            email_deferred=fields["BOOTSTRAP_ADMIN_EMAIL"].default is None,
            password_deferred=fields["BOOTSTRAP_ADMIN_PASSWORD"].default is None,
            password_uses_secret_type=(
                "SecretStr" in str(fields["BOOTSTRAP_ADMIN_PASSWORD"].annotation)
            ),
            email_avoids_global_validation=(
                "EmailStr" not in str(fields["BOOTSTRAP_ADMIN_EMAIL"].annotation)
            ),
        )
    except Exception:
        return SettingsObservation(False, False, False, False, False)


def _observe_existing_admin(is_active: bool) -> tuple[BootstrapObservation, tuple[str, ...]]:
    try:
        existing = SimpleNamespace(is_admin=True, is_active=is_active)
        session = FakeSession([existing])
        observation = observe_bootstrap(
            session,
            settings=CredentialTripwire(),
            expected_hash_input=None,
        )
        return observation, tuple(session.events)
    except Exception:
        return _failed_observation(), ()


def _observe_invalid_credentials(case_id: str) -> BootstrapObservation:
    try:
        cases = {
            "missing-username": (None, "admin@example.com", "long enough password"),
            "blank-username": ("   ", "admin@example.com", "long enough password"),
            "missing-email": ("admin", None, "long enough password"),
            "invalid-email": ("admin", "not-an-email", "long enough password"),
            "missing-password": ("admin", "admin@example.com", None),
            "short-password": ("admin", "admin@example.com", " short "),
            "long-password": ("admin", "admin@example.com", "x" * 1025),
        }
        username, email, candidate = cases[case_id]
        supplied = PrivateSettings(
            ENVIRONMENT="PROD",
            BOOTSTRAP_ADMIN_USERNAME=username,
            BOOTSTRAP_ADMIN_EMAIL=email,
            BOOTSTRAP_ADMIN_PASSWORD=(
                SecretStr(candidate) if isinstance(candidate, str) else None
            ),
        )
        return observe_bootstrap(
            FakeSession([None]),
            settings=supplied,
            expected_hash_input=None,
        )
    except Exception:
        return _failed_observation()


def _observe_whitespace_password(case_id: str) -> BootstrapObservation:
    try:
        candidate = " " * (12 if case_id == "minimum-length" else 24)
        supplied = PrivateSettings(
            ENVIRONMENT="PROD",
            BOOTSTRAP_ADMIN_USERNAME="admin",
            BOOTSTRAP_ADMIN_EMAIL="admin@example.com",
            BOOTSTRAP_ADMIN_PASSWORD=SecretStr(candidate),
        )
        return observe_bootstrap(
            FakeSession([None, None]),
            settings=supplied,
            expected_hash_input=None,
        )
    except Exception:
        return _failed_observation()


def _observe_edge_space_password() -> BootstrapObservation:
    try:
        candidate = "  " + "Strong bootstrap value 8" + "  "
        supplied = PrivateSettings(
            ENVIRONMENT="PROD",
            BOOTSTRAP_ADMIN_USERNAME="admin",
            BOOTSTRAP_ADMIN_EMAIL="admin@example.com",
            BOOTSTRAP_ADMIN_PASSWORD=SecretStr(candidate),
        )
        return observe_bootstrap(
            FakeSession([None, None]),
            settings=supplied,
            expected_hash_input=candidate,
            expected_username="admin",
            expected_email="admin@example.com",
        )
    except Exception:
        return _failed_observation()


def _observe_identity_collision(collision_field: str) -> CollisionObservation:
    try:
        regular = SimpleNamespace(
            username=(
                _EXPECTED_USERNAME if collision_field == "username" else "regular"
            ),
            email=(
                _EXPECTED_EMAIL
                if collision_field == "email"
                else "regular@example.invalid"
            ),
            is_admin=False,
            is_active=False,
            permissions=["unchanged"],
            **{"pass" + "word": "unchanged-hash"},
        )
        before = vars(regular).copy()
        session = FakeSession([None, regular])
        observation = observe_bootstrap(session)
        return CollisionObservation(
            bootstrap=observation,
            regular_user_unchanged=vars(regular) == before,
            events=tuple(session.events),
        )
    except Exception:
        return CollisionObservation(_failed_observation(), False, ())


def _observe_serialized_starts() -> tuple[
    BootstrapObservation,
    BootstrapObservation,
    int,
    tuple[str, ...],
    tuple[str, ...],
]:
    try:
        store: list[Any] = []

        class SharedSession(FakeSession):
            def __init__(self) -> None:
                super().__init__([])

            def exec(
                self, statement: object, *, params: dict[str, Any] | None = None
            ) -> Result:
                if params is not None:
                    self.events.append("lock")
                    return Result(None)
                self.events.append("query")
                statement_text = str(statement)
                if "is_admin" in statement_text:
                    return Result(next((user for user in store if user.is_admin), None))
                return Result(None)

            def commit(self) -> None:
                super().commit()
                store.extend(self.added)

        first = SharedSession()
        second = SharedSession()
        first_observation = observe_bootstrap(first)
        second_observation = observe_bootstrap(
            second,
            settings=CredentialTripwire(),
            expected_hash_input=None,
        )
        return (
            first_observation,
            second_observation,
            len(store),
            tuple(first.events),
            tuple(second.events),
        )
    except Exception:
        return _failed_observation(), _failed_observation(), 0, (), ()


def _observe_integrity_winner() -> tuple[BootstrapObservation, tuple[str, ...]]:
    try:
        winner = SimpleNamespace(is_admin=True)
        error = IntegrityError("redacted", {}, Exception("synthetic conflict"))
        session = FakeSession([None, None, winner], commit_error=error)
        return observe_bootstrap(session), tuple(session.events)
    except Exception:
        return _failed_observation(), ()


def _observe_integrity_without_winner() -> tuple[
    BootstrapObservation, tuple[str, ...]
]:
    try:
        canary = "unique-integrity-detail-canary"
        error = IntegrityError("statement carrying details", {}, Exception(canary))
        session = FakeSession([None, None, None], commit_error=error)
        observation = observe_bootstrap(session, canary_values=(canary,))
        return observation, tuple(session.events)
    except Exception:
        return _failed_observation(), ()


def _observe_internal_failure(case_id: str) -> tuple[
    BootstrapObservation, tuple[str, ...]
]:
    try:
        canary = "unique-internal-failure-canary"
        if case_id == "hash":
            session = FakeSession([None, None])
            observation = observe_bootstrap(
                session,
                canary_values=(canary,),
                hash_error=RuntimeError(canary),
            )
            return observation, tuple(session.events)

        class FailingSession(FakeSession):
            def exec(
                self, statement: object, *, params: dict[str, Any] | None = None
            ) -> Result:
                if params is not None:
                    return super().exec(statement, params=params)
                self.events.append("query")
                raise RuntimeError(canary)

        session = FailingSession([])
        observation = observe_bootstrap(session, canary_values=(canary,))
        return observation, tuple(session.events)
    except Exception:
        return _failed_observation(), ()


def _observe_unsupported_dialect() -> tuple[BootstrapObservation, tuple[str, ...]]:
    try:
        session = FakeSession([], dialect="sqlite")
        observation = observe_bootstrap(
            session,
            settings=CredentialTripwire(),
            expected_hash_input=None,
        )
        return observation, tuple(session.events)
    except Exception:
        return _failed_observation(), ()


def test_bootstrap_settings_are_optional_and_deferred() -> None:
    observation = _observe_settings_defaults()

    assert observation.username_deferred is True
    assert observation.email_deferred is True
    assert observation.password_deferred is True
    assert observation.password_uses_secret_type is True
    assert observation.email_avoids_global_validation is True


def test_fresh_install_creates_one_rotating_admin_and_hashes_once() -> None:
    session = FakeSession([None, None])
    observation = observe_bootstrap(session)

    assert session.events == [
        "isolation",
        "lock",
        "query",
        "query",
        "add",
        "commit",
    ]
    assert observation.succeeded is True
    assert observation.output_empty is True
    assert observation.hash_count == 1
    assert observation.hash_input_preserved is True
    assert observation.added_count == 1
    assert observation.normalized_identity is True
    assert observation.opaque_hash_assigned is True
    assert observation.admin_flags_valid is True
    assert observation.permissions_valid is True


def test_fresh_install_supplies_the_required_user_fields() -> None:
    observation = observe_bootstrap(FakeSession([None, None]))

    # This verifies constructor inputs only; the fake session does not prove real DB constraints.
    assert observation.required_user_fields_supplied is True


@pytest.mark.parametrize("is_active", [True, False])
def test_any_existing_admin_is_a_strict_noop(is_active: bool) -> None:
    observation, events = _observe_existing_admin(is_active)

    assert events == ("isolation", "lock", "query")
    assert observation.succeeded is True
    assert observation.failure_status == "none"
    assert observation.hash_count == 0
    assert observation.added_count == 0
    assert observation.output_empty is True


@pytest.mark.parametrize(
    ("case_id", "expected_status"),
    (
        ("missing-username", "invalid-username"),
        ("blank-username", "invalid-username"),
        ("missing-email", "invalid-email"),
        ("invalid-email", "invalid-email"),
        ("missing-password", "invalid-password"),
        ("short-password", "invalid-password"),
        ("long-password", "invalid-password"),
    ),
)
def test_invalid_credentials_fail_closed_without_secret_output(
    case_id: str, expected_status: str
) -> None:
    observation = _observe_invalid_credentials(case_id)

    assert observation.succeeded is False
    assert observation.failure_status == expected_status
    assert observation.failure_chain_suppressed is True
    assert observation.output_empty is True
    assert observation.added_count == 0


@pytest.mark.parametrize("case_id", ("minimum-length", "longer"))
def test_whitespace_only_password_is_rejected(case_id: str) -> None:
    observation = _observe_whitespace_password(case_id)

    assert observation.succeeded is False
    assert observation.failure_status == "invalid-password"
    assert observation.output_empty is True
    assert observation.hash_count == 0
    assert observation.added_count == 0


def test_nonblank_password_preserves_leading_and_trailing_spaces_for_hashing() -> None:
    observation = _observe_edge_space_password()

    assert observation.succeeded is True
    assert observation.hash_count == 1
    assert observation.hash_input_preserved is True
    assert observation.output_empty is True
    assert observation.added_count == 1


def test_exact_development_bootstrap_identity_allows_admin_password() -> None:
    supplied = PrivateSettings(
        ENVIRONMENT="DEV",
        BOOTSTRAP_ADMIN_USERNAME="admin",
        BOOTSTRAP_ADMIN_EMAIL="admin@iotapp.com",
        BOOTSTRAP_ADMIN_PASSWORD=SecretStr("admin"),
    )

    observation = observe_bootstrap(
        FakeSession([None, None]),
        settings=supplied,
        expected_hash_input="admin",
        expected_username="admin",
        expected_email="admin@iotapp.com",
    )

    assert observation.succeeded is True
    assert observation.hash_input_preserved is True
    assert observation.admin_flags_valid is True


@pytest.mark.parametrize(
    ("environment", "username", "email"),
    (
        ("PROD", "admin", "admin@iotapp.com"),
        ("DEV", "another-admin", "admin@iotapp.com"),
        ("DEV", "admin", "another@iotapp.com"),
    ),
)
def test_admin_password_bypass_is_rejected_outside_exact_dev_identity(
    environment: str, username: str, email: str
) -> None:
    supplied = PrivateSettings(
        ENVIRONMENT=environment,
        BOOTSTRAP_ADMIN_USERNAME=username,
        BOOTSTRAP_ADMIN_EMAIL=email,
        BOOTSTRAP_ADMIN_PASSWORD=SecretStr("admin"),
    )

    observation = observe_bootstrap(
        FakeSession([None]),
        settings=supplied,
        expected_hash_input=None,
    )

    assert observation.succeeded is False
    assert observation.failure_status == "invalid-password"
    assert observation.hash_count == 0


@pytest.mark.parametrize(
    "candidate",
    ("short", "alllowercase8", "ALLUPPERCASE8", "NoDigitsHere"),
)
def test_shared_password_policy_rejects_weak_passwords(candidate: str) -> None:
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password_policy(candidate)


def test_shared_password_policy_accepts_required_complexity() -> None:
    assert validate_password_policy("StrongPass8") == "StrongPass8"


@pytest.mark.parametrize(
    "payload_factory",
    (
        lambda password: UserCreate(
            email="user@example.com", username="user", password=password
        ),
        lambda password: UserUpdate(password=password),
        lambda password: UserPasswordUpdate(
            new_password=password, confirm_password=password
        ),
        lambda password: ResetPasswordRequest(
            token="opaque-token", new_password=password, confirm_password=password
        ),
    ),
)
def test_every_password_dto_uses_shared_policy(payload_factory: Any) -> None:
    with pytest.raises(ValueError, match="at least 8 characters"):
        payload_factory("weak")

    assert payload_factory("StrongPass8") is not None


def test_raw_service_password_paths_reject_weak_values_before_side_effects() -> None:
    from app.api.auth.service import AuthService

    class RepositoryTripwire:
        def __getattr__(self, _name: str) -> Any:
            raise AssertionError("Weak passwords must fail before repository access.")

    service = AuthService(RepositoryTripwire())

    with pytest.raises(ValueError, match="at least 8 characters"):
        asyncio.run(service.change_password(SimpleNamespace(), "weak"))
    with pytest.raises(ValueError, match="at least 8 characters"):
        asyncio.run(service.reset_password("opaque-token", "weak"))


def test_legacy_reset_admin_password_backdoor_is_not_routed() -> None:
    from app.api.auth.router import router

    assert "/reset-admin" not in {route.path for route in router.routes}


@pytest.mark.parametrize("collision_field", ["username", "email"])
def test_identity_collision_never_promotes_or_mutates_regular_user(
    collision_field: str,
) -> None:
    observation = _observe_identity_collision(collision_field)

    assert observation.bootstrap.succeeded is False
    assert observation.bootstrap.failure_status == "identity-collision"
    assert observation.bootstrap.failure_chain_suppressed is True
    assert observation.regular_user_unchanged is True
    assert observation.events == ("isolation", "lock", "query", "query")
    assert observation.bootstrap.added_count == 0


def test_unrelated_regular_users_allow_initial_admin() -> None:
    observation = observe_bootstrap(FakeSession([None, None]))

    assert observation.succeeded is True
    assert observation.added_count == 1


def test_two_serialized_starts_create_exactly_one_admin() -> None:
    first, second, stored_count, first_events, second_events = (
        _observe_serialized_starts()
    )

    assert first.succeeded is True
    assert second.succeeded is True
    assert stored_count == 1
    assert first_events == ("isolation", "lock", "query", "query", "add", "commit")
    assert second_events == ("isolation", "lock", "query")


def test_integrity_error_relocks_and_accepts_only_admin_winner() -> None:
    observation, events = _observe_integrity_winner()

    assert observation.succeeded is True
    assert events == (
        "isolation",
        "lock",
        "query",
        "query",
        "add",
        "commit",
        "rollback",
        "isolation",
        "lock",
        "query",
    )


def test_integrity_error_without_admin_winner_fails_sanitized() -> None:
    observation, events = _observe_integrity_without_winner()

    assert observation.succeeded is False
    assert observation.failure_status == "bootstrap-failed"
    assert observation.canary_hidden is True
    assert observation.failure_chain_suppressed is True
    assert observation.output_empty is True
    assert events[-4:] == ("rollback", "isolation", "lock", "query")


@pytest.mark.parametrize("case_id", ("database", "hash"))
def test_internal_failure_is_value_free_and_does_not_continue(case_id: str) -> None:
    observation, events = _observe_internal_failure(case_id)

    assert observation.succeeded is False
    assert observation.failure_status == "bootstrap-failed"
    assert observation.canary_hidden is True
    assert observation.failure_chain_suppressed is True
    assert observation.output_empty is True
    if case_id == "database":
        assert events == ("isolation", "lock", "query")
    else:
        assert events == ("isolation", "lock", "query", "query")


def test_unsupported_dialect_fails_before_queries_or_credentials() -> None:
    observation, events = _observe_unsupported_dialect()

    assert observation.succeeded is False
    assert observation.failure_status == "unsupported-dialect"
    assert events == ()


def test_main_lifespan_runs_init_admin_mqtt_in_order_and_stops() -> None:
    from app import main

    events: list[str] = []
    mqtt = SimpleNamespace(
        start=lambda: events.append("mqtt.start"),
        stop=lambda: events.append("mqtt.stop"),
    )

    with (
        patch.object(
            init_data,
            "create_default_admin",
            side_effect=lambda: events.append("admin"),
        ),
        patch.object(main, "mqtt_client", mqtt),
    ):
        async def exercise() -> None:
            async with main.lifespan(SimpleNamespace()):
                events.append("running")

        asyncio.run(exercise())

    assert events == ["admin", "mqtt.start", "running", "mqtt.stop"]
