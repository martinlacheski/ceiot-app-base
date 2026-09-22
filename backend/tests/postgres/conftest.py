"""Reusable fixtures for tests that must exercise PostgreSQL RLS.

The application development role may bypass RLS.  This module therefore creates
an idempotent login role with ``NOSUPERUSER NOBYPASSRLS`` and grants it access to
the existing database objects.  Tests are skipped with a clear reason when the
configured database is not PostgreSQL or the current role cannot provision the
test role.

The role is intentionally retained after the test session so interrupted and
repeated runs remain safe.  Its attributes and grants are reconciled on every
run.
"""

from collections.abc import Callable
from dataclasses import dataclass
import secrets

import pytest
import pytest_asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import settings


RLS_TEST_ROLE = "ceiot_rls_test"


@dataclass(frozen=True)
class PostgresRLSConfig:
    admin_url: str
    role_url: str


def _sync_postgres_url(url: URL) -> URL:
    if url.drivername == "postgresql+asyncpg":
        return url.set(drivername="postgresql+psycopg")
    return url


@pytest.fixture(scope="session")
def postgres_rls_config() -> PostgresRLSConfig:
    """Provision an idempotent, non-bypass role against the configured database."""
    role_password = secrets.token_urlsafe(32)
    configured_url = make_url(settings.DATABASE_URL)
    if configured_url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL RLS tests require a PostgreSQL DATABASE_URL")

    admin_url = _sync_postgres_url(configured_url)
    admin_engine = create_engine(admin_url, pool_pre_ping=True)

    try:
        with admin_engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as connection:
            database_name = connection.scalar(text("SELECT current_database()"))
            schema_name = connection.scalar(text("SELECT current_schema()")) or "public"
            quote = connection.dialect.identifier_preparer.quote
            quoted_database = quote(database_name)
            quoted_schema = quote(schema_name)
            quoted_role = quote(RLS_TEST_ROLE)

            connection.exec_driver_sql(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_roles WHERE rolname = '{RLS_TEST_ROLE}'
                    ) THEN
                        CREATE ROLE {quoted_role} LOGIN
                            PASSWORD '{role_password}'
                            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
                            NOREPLICATION NOBYPASSRLS;
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
            connection.exec_driver_sql(
                f"GRANT CONNECT ON DATABASE {quoted_database} TO {quoted_role}"
            )
            connection.exec_driver_sql(
                f"GRANT USAGE ON SCHEMA {quoted_schema} TO {quoted_role}"
            )
            connection.exec_driver_sql(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "
                f"{quoted_schema} TO {quoted_role}"
            )
            connection.exec_driver_sql(
                f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {quoted_schema} "
                f"TO {quoted_role}"
            )
    except (OSError, SQLAlchemyError) as exc:
        pytest.skip(f"Cannot provision PostgreSQL NOBYPASSRLS test role: {exc}")
    finally:
        admin_engine.dispose()

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
