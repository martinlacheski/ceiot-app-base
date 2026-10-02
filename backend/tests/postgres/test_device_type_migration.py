"""Migration 0018 (device type template) on a scratch database: seed, backfill, constraints, round trip.

A throwaway ``<dev_db>_n2mig`` database is migrated to 0017, filled with devices, upgraded,
downgraded and upgraded again. It never touches the dev or the shared test database.
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]
AMBIENTAL = uuid.UUID("6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32")


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_n2mig"
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


def _insert_device(connection, type_id, serial, model):
    connection.execute(text(
        "INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, device_type_id, model) "
        "VALUES (:i, :s, 'd', 'NEW', true, true, false, :t, :m)"),
        {"i": uuid.uuid4(), "s": serial, "t": type_id, "m": model})


def test_upgrade_seeds_ambiental_backfills_hardware_model_and_round_trips(scratch_url):
    _must(scratch_url, "upgrade", "0017")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        # Most common model wins; blanks are ignored; ties resolve alphabetically.
        for index, model in enumerate(["ESP32-DevKit", "ESP32-DevKit", "ESP32-S3", "", None]):
            _insert_device(connection, AMBIENTAL, f"IOT-AAAA-000{index}", model)
    engine.dispose()

    _must(scratch_url, "upgrade", "0018")

    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        row = connection.execute(text(
            "SELECT hardware_model, min_sensors, telemetry_interval_s, offline_after_s, config_template, description, created_at "
            "FROM device_type WHERE id = :i"), {"i": AMBIENTAL}).one()
        assert row.hardware_model == "ESP32-DevKit"
        assert row.min_sensors == 1
        assert row.telemetry_interval_s is None and row.offline_after_s is None
        assert row.config_template == {}
        assert row.created_at is not None
        # device.model is kept: a board revision can differ per unit.
        assert connection.scalar(text("SELECT count(*) FROM device WHERE model = 'ESP32-S3'")) == 1

        compat = connection.execute(text(
            "SELECT s.code, dts.required, dts.max_count, dts.included_by_default FROM device_type_sensor dts "
            "JOIN sensor s ON s.id = dts.sensor_id WHERE dts.device_type_id = :i ORDER BY s.code"), {"i": AMBIENTAL}).all()
        assert [(r.code, r.required, r.included_by_default) for r in compat] == [
            ("bme280", False, True), ("bmp280", False, False), ("dht11", False, False), ("dht22", False, False)]
        assert all(r.max_count == 2 for r in compat)
        assert connection.scalar(text(
            "SELECT count(*) FROM device_type WHERE id <> :i AND min_sensors <> 0"), {"i": AMBIENTAL}) == 0

        # Constraints.
        def fails(sql, **params):
            nested = connection.begin_nested()
            try:
                connection.execute(text(sql), params)
            except IntegrityError:
                return True
            finally:
                nested.rollback()
            return False

        assert fails("UPDATE device_type SET telemetry_interval_s = 1 WHERE id = :i", i=AMBIENTAL)
        assert fails("UPDATE device_type SET telemetry_interval_s = 90000 WHERE id = :i", i=AMBIENTAL)
        assert fails("UPDATE device_type SET offline_after_s = 1 WHERE id = :i", i=AMBIENTAL)
        assert fails("UPDATE device_type SET min_sensors = -1 WHERE id = :i", i=AMBIENTAL)
        assert fails("UPDATE device_type SET config_template = '[]'::jsonb WHERE id = :i", i=AMBIENTAL)
        assert fails("UPDATE device_type_sensor SET max_count = 0 WHERE device_type_id = :i", i=AMBIENTAL)
        assert fails(
            "INSERT INTO device_type_sensor (device_type_id, sensor_id) "
            "SELECT device_type_id, sensor_id FROM device_type_sensor LIMIT 1")
        # RLS: the catalog is protected like sensor_variable.
        flags = connection.execute(text(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'device_type_sensor'")).one()
        assert tuple(flags) == (True, True)
        policies = set(connection.execute(text(
            "SELECT polname FROM pg_policy WHERE polrelid = 'device_type_sensor'::regclass")).scalars().all())
        assert policies == {"catalog_read", "catalog_insert", "catalog_update", "catalog_delete"}
    engine.dispose()

    _must(scratch_url, "downgrade", "0017")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT to_regclass('public.device_type_sensor')")) is None
        columns = set(connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'device_type'")).scalars().all())
        assert not columns & {"description", "hardware_model", "telemetry_interval_s", "offline_after_s",
                              "min_sensors", "config_template", "created_at"}
        assert connection.scalar(text("SELECT count(*) FROM device")) == 5
    engine.dispose()

    _must(scratch_url, "upgrade", "head")
