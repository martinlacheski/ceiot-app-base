"""Migrations 0020 (drop sensorreading.device_type) and 0021 (catalog created_at).

A throwaway ``<dev_db>_d3mig`` database is migrated to 0019, seeded with a reading and a
catalog row, upgraded, downgraded and upgraded again. It never touches the dev or the
shared test database.
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]

CREATED_AT_TABLES = (
    "device",
    "environment",
    "environmenttype",
    "locationcountry",
    "locationstate",
    "locationcity",
    "identificationtype",
)


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.ALEMBIC_DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_d3mig"
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


def _column(connection, table, column):
    return connection.execute(text(
        "SELECT data_type, is_nullable, column_default FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).first()


def test_upgrade_drops_device_type_adds_created_at_and_round_trips(scratch_url):
    _must(scratch_url, "upgrade", "0019")
    reading_id, country_id = uuid.uuid4(), uuid.uuid4()
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO sensorreading (time, id, device_serial, device_type) "
            "VALUES (now(), :i, 'SER-1', 'generic')"
        ), {"i": reading_id})
        connection.execute(text(
            "INSERT INTO locationcountry (id, name, is_active) VALUES (:i, 'Pais', true)"
        ), {"i": country_id})
    engine.dispose()

    _must(scratch_url, "upgrade", "0021")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert _column(connection, "sensorreading", "device_type") is None
        # The hypertable still accepts readings without the dropped column.
        connection.execute(text(
            "INSERT INTO sensorreading (time, id, device_serial) VALUES (now(), :i, 'SER-2')"
        ), {"i": uuid.uuid4()})
        for table in CREATED_AT_TABLES:
            data_type, nullable, default = _column(connection, table, "created_at")
            assert data_type == "timestamp with time zone", table
            assert nullable == "NO", table
            assert default == "now()", table
        # Existing rows were backfilled by the default.
        assert connection.scalar(text(
            "SELECT created_at IS NOT NULL FROM locationcountry WHERE id = :i"
        ), {"i": country_id})
    engine.dispose()

    _must(scratch_url, "downgrade", "0019")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        for table in CREATED_AT_TABLES:
            assert _column(connection, table, "created_at") is None, table
        data_type, nullable, default = _column(connection, "sensorreading", "device_type")
        assert data_type == "character varying"
        assert nullable == "NO"
        assert default is None
        values = set(connection.execute(text("SELECT device_type FROM sensorreading")).scalars())
        assert values == {"generic"}
    engine.dispose()

    _must(scratch_url, "upgrade", "head")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        assert _column(connection, "sensorreading", "device_type") is None
        assert all(_column(connection, table, "created_at") for table in CREATED_AT_TABLES)
    engine.dispose()
