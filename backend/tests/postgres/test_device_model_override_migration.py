"""Migration 0024: ``device.model`` becomes an optional override of the type's hardware model.

A throwaway ``<dev_db>_n6mig`` database is migrated to 0023 and seeded with devices whose
model equals the type default (exact, different case, surrounding spaces), differs from it,
is blank or NULL, or belongs to a type without a hardware model. It is upgraded, downgraded (which
materializes the type default into every NULL row) and upgraded again. It never touches the
dev or the shared test database.
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
TYPE_MODEL = "ESP32-DevKit"

# serial -> (type key, model before 0024, model after 0024, model after downgrade)
DEVICES = {
    "IOT-N6-0001": ("board", "ESP32-DevKit", None, "ESP32-DevKit"),
    "IOT-N6-0002": ("board", "esp32-devkit", None, "ESP32-DevKit"),
    "IOT-N6-0003": ("board", "  ESP32-DevKit ", None, "ESP32-DevKit"),
    "IOT-N6-0004": ("board", "ESP32-S3", "ESP32-S3", "ESP32-S3"),
    "IOT-N6-0005": ("board", None, None, "ESP32-DevKit"),
    "IOT-N6-0006": ("bare", "Custom-1", "Custom-1", "Custom-1"),
    "IOT-N6-0007": ("bare", None, None, None),
    "IOT-N6-0008": ("bare", "  ", None, None),
}


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.ALEMBIC_DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_n6mig"
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
        connection.exec_driver_sql(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %(n)s AND pid <> pg_backend_pid()",
            {"n": name},
        )
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _must(url, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False))
    result = subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-2000:]


def _models(url):
    engine = create_engine(url)
    with engine.connect() as connection:
        rows = dict(connection.execute(text(
            "SELECT serial, model FROM device WHERE serial LIKE 'IOT-N6-%'"
        )).all())
    engine.dispose()
    return rows


def test_upgrade_nulls_defaults_and_downgrade_materializes_them(scratch_url):
    types = {"board": uuid.uuid4(), "bare": uuid.uuid4()}
    _must(scratch_url, "upgrade", "0023")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO device_type (id, code, name, hardware_model, is_active) "
            "VALUES (:b, 'n6_board', 'N6 Placa', :m, true), (:n, 'n6_bare', 'N6 Sin modelo', NULL, true)"
        ), {"b": types["board"], "n": types["bare"], "m": TYPE_MODEL})
        for serial, (type_key, model, _, _) in DEVICES.items():
            connection.execute(text(
                "INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, "
                "device_type_id, model) VALUES (:i, :s, 'd', 'NEW', true, true, false, :t, :m)"
            ), {"i": uuid.uuid4(), "s": serial, "t": types[type_key], "m": model})
    engine.dispose()

    _must(scratch_url, "upgrade", "0024")
    assert _models(scratch_url) == {serial: row[2] for serial, row in DEVICES.items()}

    _must(scratch_url, "downgrade", "0023")
    assert _models(scratch_url) == {serial: row[3] for serial, row in DEVICES.items()}

    _must(scratch_url, "upgrade", "head")
    assert _models(scratch_url) == {serial: row[2] for serial, row in DEVICES.items()}
