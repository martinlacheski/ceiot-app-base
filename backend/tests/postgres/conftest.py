"""Reusable fixtures for tests that must exercise PostgreSQL RLS.

These tests never run against the configured application (dev) database.
They target a dedicated ``<dev_db_name>_test`` database on the same
PostgreSQL server: it is dropped and recreated at the start of every test
session (so runs are always reproducible, and an interrupted previous run
never leaks fixture rows into it), migrated to ``alembic`` head, and then
used for both the admin connection (the migration superuser,
``ALEMBIC_DATABASE_URL``) and the non-superuser ``NOBYPASSRLS`` role below.

``ceiot_rls_test`` stands in for the application login (``iot_app``): every
migration run by the test suite targets it as ``DB_APP_ROLE``, so its
privileges are exactly the ones migration 0029 grants the application in
production (no extra grants are added here). Provisioning (CREATE DATABASE,
the role) uses the migration superuser, never ``DATABASE_URL``: the
application login cannot create databases. Tests are skipped with a clear
reason when the configured database is not PostgreSQL, the migration role
cannot provision the test database, or the migration fails.

The role is cluster-wide (roles are not per-database in PostgreSQL) and is
intentionally retained after the test session so interrupted and repeated
runs remain safe. Its attributes are reconciled on every run.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
import os
import re
import secrets
import subprocess

import pytest
import pytest_asyncio
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import settings


RLS_TEST_ROLE = "ceiot_rls_test"
TEST_DATABASE_SUFFIX = "_test"
# Migration 0029 grants the application privileges to this role. Every alembic
# subprocess started by these tests inherits it, so test migrations never grant
# (or revoke) anything on the cluster's real application login.
APP_ROLE_ENV = "DB_APP_ROLE"

# tests/postgres/conftest.py -> tests/postgres -> tests -> backend root
# (the directory that holds alembic.ini).
BACKEND_ROOT = Path(__file__).resolve().parents[2]

_CREDENTIALS_PATTERN = re.compile(r"//[^/@]+@")


def _redact(text_with_possible_credentials: str) -> str:
    """Strip a possible ``user:password@`` segment before it reaches a test report."""
    return _CREDENTIALS_PATTERN.sub("//***@", text_with_possible_credentials)


@dataclass(frozen=True)
class PostgresRLSConfig:
    admin_url: str
    role_url: str


def _sync_postgres_url(url: URL) -> URL:
    if url.drivername == "postgresql+asyncpg":
        return url.set(drivername="postgresql+psycopg")
    return url


def _test_database_url(url: URL) -> URL:
    """The dedicated test database's URL: same server/role, different database."""
    return url.set(database=f"{url.database}{TEST_DATABASE_SUFFIX}")


def _recreate_test_database(dev_sync_url: URL, test_db_name: str) -> None:
    """Drop (if present) and recreate the dedicated test database.

    Connects through the *dev* database as maintenance connection (never the
    test database itself, which cannot DROP/CREATE itself), so this never
    touches dev data -- only the sibling ``_test`` database's existence.
    """
    maintenance_engine = create_engine(dev_sync_url, pool_pre_ping=True)
    try:
        with maintenance_engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as connection:
            quoted_db = connection.dialect.identifier_preparer.quote(test_db_name)
            # Defensively close any lingering connections from a previous
            # interrupted run before dropping.
            connection.exec_driver_sql(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %(name)s AND pid <> pg_backend_pid()",
                {"name": test_db_name},
            )
            connection.exec_driver_sql(f"DROP DATABASE IF EXISTS {quoted_db}")
            connection.exec_driver_sql(f"CREATE DATABASE {quoted_db}")
    finally:
        maintenance_engine.dispose()


def _migrate_test_database(test_sync_url: URL) -> None:
    """Run ``alembic upgrade head`` against the dedicated test database.

    Alembic's env.py reads ``ALEMBIC_DATABASE_URL`` from the process
    environment directly (not from alembic.ini), so the override is passed
    only to this subprocess's environment -- the pytest process's own
    environment (and therefore every other fixture/connection reading
    ``settings.DATABASE_URL``) is left untouched.
    """
    child_env = dict(os.environ)
    child_env["ALEMBIC_DATABASE_URL"] = test_sync_url.render_as_string(hide_password=False)
    child_env[APP_ROLE_ENV] = RLS_TEST_ROLE
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=str(BACKEND_ROOT),
        env=child_env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "alembic upgrade head failed for the dedicated test database: "
            f"{_redact(result.stdout)}\n{_redact(result.stderr)}"
        )


@pytest.fixture(scope="session", autouse=True)
def _migrations_target_the_test_role():
    """Point ``DB_APP_ROLE`` at the test role for every migration of this package."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv(APP_ROLE_ENV, RLS_TEST_ROLE)
        yield


def admin_database_url() -> URL:
    """The migration superuser's URL (the application login cannot create databases)."""
    return make_url(settings.ALEMBIC_DATABASE_URL)


def _reconcile_test_role(admin_sync_url: URL, role_password: str) -> None:
    """Create or reset the login role before migrating (0029 grants to it)."""
    engine = create_engine(admin_sync_url, pool_pre_ping=True)
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            quoted_role = connection.dialect.identifier_preparer.quote(RLS_TEST_ROLE)
            connection.exec_driver_sql(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_roles WHERE rolname = '{RLS_TEST_ROLE}'
                    ) THEN
                        CREATE ROLE {quoted_role} NOLOGIN;
                    END IF;
                END
                $$
                """
            )
            connection.exec_driver_sql(
                f"ALTER ROLE {quoted_role} LOGIN PASSWORD '{role_password}' "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT "
                "NOREPLICATION NOBYPASSRLS"
            )
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def postgres_rls_config() -> PostgresRLSConfig:
    """Provision the dedicated test database, migrated with the test role as application role."""
    role_password = secrets.token_urlsafe(32)
    dev_url = admin_database_url()
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL RLS tests require a PostgreSQL DATABASE_URL")

    # Every URL derived below points at the dedicated "<dev_db>_test"
    # database, never at dev_url itself.
    configured_url = _test_database_url(dev_url)
    dev_sync_url = _sync_postgres_url(dev_url)
    test_sync_url = _sync_postgres_url(configured_url)

    try:
        _reconcile_test_role(dev_sync_url, role_password)
        _recreate_test_database(dev_sync_url, test_sync_url.database)
        _migrate_test_database(test_sync_url)
    except (OSError, SQLAlchemyError, RuntimeError) as exc:
        pytest.skip(f"Cannot provision the dedicated PostgreSQL test database: {_redact(str(exc))}")

    role_url = configured_url.set(
        username=RLS_TEST_ROLE,
        password=role_password,
    )
    return PostgresRLSConfig(
        admin_url=configured_url.render_as_string(hide_password=False),
        role_url=role_url.render_as_string(hide_password=False),
    )


@pytest_asyncio.fixture
async def rls_engine_factory(
    postgres_rls_config: PostgresRLSConfig,
) -> Callable[..., AsyncEngine]:
    """Build tracked role engines so each behavioral test owns its pool."""
    engines: list[AsyncEngine] = []

    def create(*, pool_size: int = 1) -> AsyncEngine:
        role_engine = create_async_engine(
            postgres_rls_config.role_url,
            pool_size=pool_size,
            max_overflow=0,
            pool_pre_ping=True,
        )

        # Tests are authored before the production hook.  Before the fix this is
        # deliberately a no-op, allowing the behavioral test to expose the leak.
        from app.core import db as db_module

        install_reset = getattr(db_module, "install_rls_identity_reset", None)
        if install_reset is not None:
            install_reset(role_engine)

        engines.append(role_engine)
        return role_engine

    yield create

    for role_engine in engines:
        await role_engine.dispose()
