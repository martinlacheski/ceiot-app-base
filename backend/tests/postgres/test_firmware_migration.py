"""Migration 0019 (firmware catalog and OTA attempts) on a scratch database, and its RLS.

A throwaway ``<dev_db>_fwmig`` database is migrated to 0018, upgraded to 0019, downgraded and
upgraded again. It never touches the dev or the shared test database.
"""

import os
import subprocess
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_fwmig"
    scratch = dev_sync.set(database=name)
    try:
        maintenance = create_engine(dev_sync, isolation_level="AUTOCOMMIT")
        with maintenance.connect() as connection:
            connection.exec_driver_sql(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %(n)s AND pid <> pg_backend_pid()",
                {"n": name},
            )
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    except SQLAlchemyError as exc:
        pytest.skip(f"cannot create the scratch database: {type(exc).__name__}")
    yield scratch
    with maintenance.connect() as connection:
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _must(url, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False))
    result = subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-2000:]


def _tables(connection) -> set[str]:
    return set(connection.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'firmware_%'"
    )).scalars())


def _operation_types(connection) -> list[str]:
    return list(connection.execute(text(
        "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
        "WHERE t.typname = 'deviceoperationtype' ORDER BY e.enumsortorder"
    )).scalars())


def test_upgrade_creates_the_tables_and_the_operation_type_and_round_trips(scratch_url):
    _must(scratch_url, "upgrade", "0018")
    _must(scratch_url, "upgrade", "0019")

    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        assert _tables(connection) == {"firmware_release", "firmware_update"}
        assert "FIRMWARE_UPDATE" in _operation_types(connection)
        rls = dict(connection.execute(text(
            "SELECT relname, relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE relname IN ('firmware_release', 'firmware_update')"
        )).all())
        assert rls == {"firmware_release": True, "firmware_update": True}
    engine.dispose()

    _must(scratch_url, "downgrade", "0018")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        assert _tables(connection) == set()
        # PostgreSQL cannot drop an enum value: it stays, unused, after the downgrade.
        assert "FIRMWARE_UPDATE" in _operation_types(connection)
    engine.dispose()

    _must(scratch_url, "upgrade", "head")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        assert _tables(connection) == {"firmware_release", "firmware_update"}
        assert _operation_types(connection).count("FIRMWARE_UPDATE") == 1
    engine.dispose()


@asynccontextmanager
async def _as(engine, identity):
    async with engine.connect() as connection:
        async with AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, false)"), {"uid": identity})
            yield session


@pytest.mark.asyncio
async def test_firmware_rows_are_reachable_only_by_admins_and_system(postgres_rls_config, rls_engine_factory):
    admin_engine = create_async_engine(postgres_rls_config.admin_url)
    suffix = uuid.uuid4().hex[:8]
    administrator = User(email=f"fw-admin-{suffix}@example.com", username=f"fw-admin-{suffix}",
                         password="x", is_admin=True)
    ordinary = User(email=f"fw-user-{suffix}@example.com", username=f"fw-user-{suffix}", password="x")
    insert = text(
        "INSERT INTO firmware_release (id, version, storage_key, sha256, size, active, created_at) "
        "VALUES (:id, :v, 'k', :sha, 10, true, now())"
    )
    count = text("SELECT count(*) FROM firmware_release WHERE id = :id")
    release_id = uuid.uuid4()
    try:
        async with AsyncSession(admin_engine, expire_on_commit=False) as setup:
            setup.add_all([administrator, ordinary])
            await setup.commit()

        role_engine = rls_engine_factory()
        async with _as(role_engine, str(administrator.id)) as session:
            await session.execute(insert, {"id": release_id, "v": f"rls-{suffix}", "sha": "a" * 64})
            await session.commit()
            assert (await session.execute(count, {"id": release_id})).scalar_one() == 1

        for identity in (str(ordinary.id), "", "nobody"):
            async with _as(role_engine, identity) as session:
                assert (await session.execute(count, {"id": release_id})).scalar_one() == 0, identity
                with pytest.raises(DBAPIError):
                    await session.execute(insert, {"id": uuid.uuid4(), "v": f"x-{uuid.uuid4().hex[:6]}", "sha": "b" * 64})
                await session.rollback()

        async with _as(role_engine, "system_mqtt") as session:
            assert (await session.execute(count, {"id": release_id})).scalar_one() == 1
    finally:
        async with admin_engine.begin() as cleanup:
            await cleanup.execute(text("DELETE FROM firmware_release WHERE id = :id"), {"id": release_id})
            await cleanup.execute(text('DELETE FROM "user" WHERE id IN (:a, :b)'),
                                  {"a": administrator.id, "b": ordinary.id})
        await admin_engine.dispose()
