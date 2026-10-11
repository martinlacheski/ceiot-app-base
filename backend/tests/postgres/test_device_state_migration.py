"""Migration 0025: the device's last-known runtime state moves to the 1:1 ``device_state`` table.

A throwaway ``<dev_db>_n4mig`` database is migrated to 0024 and seeded with an owner, a guest
of the owner's environment and a stranger, plus three devices: one that reported everything,
one that never reported and one outside the environment. It is upgraded (the state moves, the
``ai_read.devices`` view now reads it), downgraded (columns, data, grants and the old view come
back) and upgraded again. Visibility is checked as ``ai_readonly`` (NOSUPERUSER NOBYPASSRLS) under
each identity. It never touches the dev or the shared test database.
"""

import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.api.assistant.catalog import VIEWS
from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]

STATE_COLUMNS = (
    "firmware_version", "ip_address", "rssi", "wifi_ssid", "last_reset_reason", "gps_latitude",
    "gps_longitude", "gps_updated_at", "last_connection", "broker_connected", "broker_connected_at",
    "broker_disconnected_at", "broker_status_updated_at",
)
T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
EDITED = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)

REPORTED = {
    "firmware_version": "1.4.2", "ip_address": "10.0.0.7", "rssi": -61, "wifi_ssid": "lab",
    "last_reset_reason": "power_on", "gps_latitude": -27.36, "gps_longitude": -55.9,
    "gps_updated_at": T0, "last_connection": T0 + timedelta(minutes=5), "broker_connected": True,
    "broker_connected_at": T0, "broker_disconnected_at": T0 - timedelta(days=1),
    "broker_status_updated_at": T0,
}
SILENT = {column: None for column in STATE_COLUMNS} | {"broker_connected": False}
OUTSIDE = SILENT | {"last_connection": T0, "firmware_version": "0.9.0"}


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_n4mig"
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


def _seed(url) -> dict:
    ids = {key: uuid.uuid4() for key in (
        "owner", "guest", "stranger", "country", "state", "city", "etype", "env", "reported", "silent",
        "outside")}
    engine = create_engine(url)
    with engine.begin() as c:
        for key in ("owner", "guest", "stranger"):
            c.execute(text(
                'INSERT INTO "user" (id, email, username, password, first_name, last_name, permissions, '
                "created_at, is_active, is_verified, is_admin, must_change_password, is_social_auth) "
                "VALUES (:id, :e, :u, 'x', 'N', 'L', '[]', now(), true, true, false, false, false)"),
                {"id": ids[key], "e": f"{key}@n4.test", "u": f"n4-{key}"})
        c.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, 'AR', true)"),
                  {"i": ids["country"]})
        c.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, 'Mis', :c, true)"),
                  {"i": ids["state"], "c": ids["country"]})
        c.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) "
                       "VALUES (:i, 'Pos', '3300', :s, true)"), {"i": ids["city"], "s": ids["state"]})
        c.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:i, 'Lab', true)"),
                  {"i": ids["etype"]})
        c.execute(text(
            "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, "
            "is_public_map_visible) VALUES (:i, 'Sala N4', 'a', 'l', 'd', :c, :t, true, false)"),
            {"i": ids["env"], "c": ids["city"], "t": ids["etype"]})
        c.execute(text("INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) "
                       "VALUES (:i, :e, :u, true, true)"), {"i": uuid.uuid4(), "e": ids["env"], "u": ids["owner"]})
        c.execute(text(
            "INSERT INTO scoped_guest_relation (id, owner_user_id, guest_user_id, scope_type, scope_id, "
            "access_starts_at, is_active, created_at) VALUES (:i, :o, :g, 'environment', :e, :s, true, now())"),
            {"i": uuid.uuid4(), "o": ids["owner"], "g": ids["guest"], "e": ids["env"], "s": T0 - timedelta(days=30)})
        dtype = c.execute(text("SELECT id FROM device_type WHERE code = 'environmental'")).scalar_one()
        for key, env, values in (("reported", ids["env"], REPORTED), ("silent", ids["env"], SILENT),
                                 ("outside", None, OUTSIDE)):
            columns = ", ".join(STATE_COLUMNS)
            params = ", ".join(f":{column}" for column in STATE_COLUMNS)
            c.execute(text(
                "INSERT INTO device (id, serial, name, status, is_active, enabled, device_type_id, environment_id, "
                f"mac_address, updated_at, {columns}) "
                f"VALUES (:i, :s, :s, 'ACTIVE', true, true, :t, :e, 'AA:BB:CC:00:00:01', :u, {params})"),
                {"i": ids[key], "s": f"N4-{key.upper()}", "t": dtype, "e": env, "u": EDITED, **values})
    engine.dispose()
    return ids


def _device_columns(connection) -> set[str]:
    return set(connection.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device'"
    )).scalars())


def _as_ai_readonly(connection, identity: str, sql: str) -> list:
    """Run ``sql`` the way the assistant does: SET LOCAL ROLE ai_readonly inside the identity."""
    if connection.in_transaction():
        connection.commit()
    with connection.begin():
        connection.execute(text("SELECT set_config('app.current_user_id', :v, true)"), {"v": identity})
        connection.execute(text("SET LOCAL ROLE ai_readonly"))
        return connection.execute(text(sql)).all()


def _visible(url, ids) -> dict:
    engine = create_engine(url)
    seen = {}
    with engine.connect() as connection:
        for who in ("owner", "guest", "stranger", "system_admin"):
            identity = who if who == "system_admin" else str(ids[who])
            seen[who] = {
                "view": sorted(tuple(row) for row in _as_ai_readonly(
                    connection, identity,
                    "SELECT serial, online, last_connection FROM ai_read.devices WHERE serial LIKE 'N4-%'")),
            }
    engine.dispose()
    return seen


def test_state_moves_to_device_state_and_back(scratch_url):
    _must(scratch_url, "upgrade", "0024")
    ids = _seed(scratch_url)

    _must(scratch_url, "upgrade", "0025")
    engine = create_engine(scratch_url)
    with engine.connect() as c:
        assert not (_device_columns(c) & set(STATE_COLUMNS))
        assert "mac_address" in _device_columns(c)  # identity, not runtime state
        rows = {
            row.device_id: dict(row._mapping)
            for row in c.execute(text(f"SELECT device_id, {', '.join(STATE_COLUMNS)}, updated_at FROM device_state"))
        }
        # One row per device that ever reported; a never-seen device has none (readers LEFT JOIN).
        assert set(rows) == {ids["reported"], ids["outside"]}
        assert {k: rows[ids["reported"]][k] for k in STATE_COLUMNS} == REPORTED
        assert {k: rows[ids["outside"]][k] for k in STATE_COLUMNS} == OUTSIDE
        assert all(row["updated_at"] is not None for row in rows.values())
        assert set(c.execute(text("SELECT updated_at FROM device WHERE serial LIKE 'N4-%'")).scalars()) == {EDITED}
        assert c.execute(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.device_state'::regclass"
        )).scalar_one()
        assert c.execute(text(
            "SELECT reloptions FROM pg_class WHERE oid = 'ai_read.devices'::regclass")).scalar_one() == [
            "security_invoker=true"]
        assert list(c.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'ai_read' "
            "AND table_name = 'devices' ORDER BY ordinal_position")).scalars()) == list(VIEWS["devices"])
        assert c.execute(text(
            "SELECT has_table_privilege('ai_readonly', 'ai_read.devices', 'SELECT') "
            "AND has_column_privilege('ai_readonly', 'public.device_state', 'last_connection', 'SELECT') "
            "AND has_column_privilege('ai_readonly', 'public.device_state', 'broker_connected', 'SELECT') "
            "AND NOT has_column_privilege('ai_readonly', 'public.device_state', 'ip_address', 'SELECT') "
            "AND NOT has_column_privilege('ai_readonly', 'public.device_state', 'wifi_ssid', 'SELECT')"
        )).scalar_one()
        state_rows = {}
        for who in ("owner", "guest", "stranger", "system_admin"):
            identity = who if who == "system_admin" else str(ids[who])
            state_rows[who] = {r[0] for r in _as_ai_readonly(
                c, identity, "SELECT device_id FROM public.device_state")}
        assert state_rows == {
            "owner": {ids["reported"]}, "guest": {ids["reported"]}, "stranger": set(),
            "system_admin": {ids["reported"], ids["outside"]},
        }
    engine.dispose()

    reported_row = ("N4-REPORTED", True, REPORTED["last_connection"])
    silent_row = ("N4-SILENT", False, None)
    outside_row = ("N4-OUTSIDE", False, OUTSIDE["last_connection"])
    expected_view = {
        "owner": [reported_row, silent_row], "guest": [reported_row, silent_row], "stranger": [],
        "system_admin": sorted([reported_row, silent_row, outside_row]),
    }
    assert {who: seen["view"] for who, seen in _visible(scratch_url, ids).items()} == {
        who: sorted(rows) for who, rows in expected_view.items()}

    _must(scratch_url, "downgrade", "0024")
    engine = create_engine(scratch_url)
    with engine.connect() as c:
        assert set(STATE_COLUMNS) <= _device_columns(c)
        assert c.execute(text("SELECT to_regclass('public.device_state')")).scalar_one() is None
        restored = {
            row.serial: {k: row._mapping[k] for k in STATE_COLUMNS}
            for row in c.execute(text(f"SELECT serial, {', '.join(STATE_COLUMNS)} FROM device WHERE serial LIKE 'N4-%'"))
        }
        assert restored == {"N4-REPORTED": REPORTED, "N4-SILENT": SILENT, "N4-OUTSIDE": OUTSIDE}
        assert c.execute(text(
            "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = 'device' AND column_name = 'broker_connected'")).scalar_one() == "NO"
        assert c.execute(text(
            "SELECT has_column_privilege('ai_readonly', 'public.device', 'last_connection', 'SELECT') "
            "AND has_column_privilege('ai_readonly', 'public.device', 'broker_connected', 'SELECT') "
            "AND has_table_privilege('ai_readonly', 'ai_read.devices', 'SELECT')"
        )).scalar_one()
        assert set(c.execute(text("SELECT updated_at FROM device WHERE serial LIKE 'N4-%'")).scalars()) == {EDITED}
    engine.dispose()
    assert {who: seen["view"] for who, seen in _visible(scratch_url, ids).items()} == {
        who: sorted(rows) for who, rows in expected_view.items()}

    _must(scratch_url, "upgrade", "head")
    engine = create_engine(scratch_url)
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM device_state")).scalar_one() == 2
        assert not (_device_columns(c) & set(STATE_COLUMNS))
    engine.dispose()
