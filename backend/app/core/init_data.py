from typing import Never

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.api.auth.models import User
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import ALL_PERMISSIONS
from app.core.security import hash_password, validate_password_policy


_BOOTSTRAP_LOCK_KEY = 4847363015984661581
_READ_COMMITTED = {"isolation_level": "READ COMMITTED"}
_EMAIL_ADAPTER = TypeAdapter(EmailStr)


class BootstrapConfigurationError(RuntimeError):
    """An operator-controlled bootstrap field is missing or invalid."""


class BootstrapSafetyError(RuntimeError):
    """The database cannot provide the required bootstrap guarantees."""


def _fail(field: str) -> Never:
    raise BootstrapConfigurationError(
        f"Bootstrap administrator {field} is missing or invalid."
    ) from None


def _prepare_locked_transaction(session: Session) -> None:
    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        raise BootstrapSafetyError(
            "Initial administrator bootstrap requires PostgreSQL locking."
        )

    # Apply per-transaction isolation before the transaction begins. READ COMMITTED
    # guarantees that the query after a waited advisory lock sees the lock winner's
    # committed administrator instead of reusing a stale repeatable-read snapshot.
    session.connection(execution_options=_READ_COMMITTED)
    session.exec(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        params={"lock_key": _BOOTSTRAP_LOCK_KEY},
    )


def _administrator_exists(session: Session) -> bool:
    administrator_id = session.exec(
        select(User.id).where(col(User.is_admin).is_(True)).limit(1)
    ).first()
    return administrator_id is not None


def _bootstrap_identity() -> tuple[str, str, str]:
    raw_username = settings.BOOTSTRAP_ADMIN_USERNAME
    if raw_username is None or not raw_username.strip():
        _fail("username")
    username = raw_username.strip()

    raw_email = settings.BOOTSTRAP_ADMIN_EMAIL
    if raw_email is None or not raw_email.strip():
        _fail("email")
    try:
        email = str(_EMAIL_ADAPTER.validate_python(raw_email.strip())).lower()
    except ValidationError:
        _fail("email")

    secret = settings.BOOTSTRAP_ADMIN_PASSWORD
    if secret is None:
        _fail("password")
    password = secret.get_secret_value()
    if len(password) > 1024 or not password.strip():
        _fail("password")

    development_bypass = (
        settings.ENVIRONMENT == "DEV"
        and username == "admin"
        and email == "admin@iotapp.com"
        and password == "admin"
    )
    if not development_bypass:
        try:
            validate_password_policy(password)
        except ValueError:
            _fail("password")

    return username, email, password


def _identity_collision_exists(session: Session, username: str, email: str) -> bool:
    user_id = session.exec(
        select(User.id)
        .where(or_(User.username == username, func.lower(User.email) == email))
        .limit(1)
    ).first()
    return user_id is not None


def _raise_bootstrap_failure() -> Never:
    raise RuntimeError("Initial administrator bootstrap failed.") from None


def create_default_admin() -> None:
    """Create the first administrator once, without changing existing accounts."""
    try:
        with Session(engine) as session:
            _prepare_locked_transaction(session)
            if _administrator_exists(session):
                return

            username, email, password = _bootstrap_identity()
            if _identity_collision_exists(session, username, email):
                raise BootstrapConfigurationError(
                    "Bootstrap administrator identity collision."
                ) from None

            admin = User(
                email=email,
                username=username,
                password=hash_password(password),
                first_name="Initial",
                last_name="Administrator",
                is_admin=True,
                must_change_password=True,
                is_active=True,
                is_verified=True,
                is_social_auth=False,
                permissions=ALL_PERMISSIONS,
            )
            session.add(admin)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                _prepare_locked_transaction(session)
                if _administrator_exists(session):
                    return
                _raise_bootstrap_failure()
    except (BootstrapConfigurationError, BootstrapSafetyError):
        raise
    except Exception:
        _raise_bootstrap_failure()


if __name__ == "__main__":
    create_default_admin()
