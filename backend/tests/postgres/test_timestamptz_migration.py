"""Migration 0022: every naive ``timestamp`` column becomes ``timestamptz`` (item 8).

A throwaway ``<dev_db>_d3tz`` database is migrated to 0021, seeded with naive UTC values,
upgraded, downgraded and upgraded again. The stored instants, the guest-window RLS
policies, the ``ai_read.devices`` view and ``ai_read.telemetry_visible`` must behave the
same for the restricted ``ai_readonly`` role at every step. It never touches the dev or the
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

NAIVE_COLUMNS = """
SELECT table_schema || '.' || table_name || '.' || column_name
FROM information_schema.columns
WHERE data_type = 'timestamp without time zone' AND table_schema IN ('public', 'ai_read')
ORDER BY 1
"""
POLICIES = """
SELECT tablename, policyname, cmd, roles::text, permissive, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
"""

CREATED = "2026-10-01 12:34:56.123456"
LAST_CONNECTION = "2026-10-01 10:00:00"
PAST_START = "2026-01-01 00:00:00"
FUTURE_START = "2999-01-01 00:00:00"


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.ALEMBIC_DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_d3tz"
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


def _seed(connection, ids):
    for key in ("owner", "guest"):
        connection.execute(text(
            'INSERT INTO "user" (id, email, username, password, first_name, last_name, created_at, '
            "is_active, is_admin, must_change_password, is_social_auth) "
            "VALUES (:i, :e, :e, 'x', 'N', 'N', :c, true, false, false, false)"
        ), {"i": ids[key], "e": f"{key}-{ids[key]}@example.com", "c": CREATED})
    type_id = connection.scalar(text("SELECT id FROM device_type ORDER BY name LIMIT 1"))
    for key, serial in (("visible", "TZ-1"), ("future", "TZ-2")):
        connection.execute(text(
            "INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, "
            "device_type_id, last_connection) "
            "VALUES (:i, :s, :s, 'ACTIVE', true, true, false, :t, :lc)"
        ), {"i": ids[key], "s": serial, "t": type_id, "lc": LAST_CONNECTION})
    for key, start in (("visible", PAST_START), ("future", FUTURE_START)):
        connection.execute(text(
            "INSERT INTO scoped_guest_relation (id, owner_user_id, guest_user_id, scope_type, scope_id, "
            "access_starts_at, is_active, created_at) "
            "VALUES (:i, :o, :g, 'device', :s, :a, true, :c)"
        ), {"i": uuid.uuid4(), "o": ids["owner"], "g": ids["guest"], "s": ids[key], "a": start, "c": CREATED})


def _as_guest(connection, ids, time_zone="UTC"):
    connection.execute(text("SET LOCAL ROLE ai_readonly"))
    connection.execute(text(f"SET LOCAL TimeZone = '{time_zone}'"))
    connection.execute(text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(ids["guest"])})


def _visible(connection, ids, at):
    return connection.scalar(text(
        "SELECT ai_read.telemetry_visible(:d, NULL, CAST(:at AS timestamptz))"
    ), {"d": ids["visible"], "at": at})


def _assert_guest_behaviour(engine, ids):
    # Same answers under UTC and a non-UTC session: the comparison is between instants.
    for time_zone in ("UTC", "America/Argentina/Buenos_Aires"):
        with engine.begin() as connection:
            _as_guest(connection, ids, time_zone)
            serials = set(connection.execute(text("SELECT serial FROM ai_read.devices")).scalars())
            assert serials == {"TZ-1"}, time_zone
            assert _visible(connection, ids, "2025-12-31 23:30:00+00") is False, time_zone
            assert _visible(connection, ids, "2026-01-01 00:30:00+00") is True, time_zone
            assert connection.scalar(text(
                "SELECT ai_read.telemetry_visible(:d, NULL, now())"
            ), {"d": ids["future"]}) is False, time_zone


def _assert_wall_clocks(connection, ids, expression):
    created = connection.scalar(text(f'SELECT ({expression("created_at")})::text FROM "user" WHERE id = :i'),
                                {"i": ids["guest"]})
    last = connection.scalar(text(f"SELECT ({expression('last_connection')})::text FROM device WHERE id = :i"),
                             {"i": ids["visible"]})
    start = connection.scalar(text(
        f"SELECT ({expression('access_starts_at')})::text FROM scoped_guest_relation WHERE scope_id = :i"
    ), {"i": ids["visible"]})
    assert (created, last, start) == (CREATED, LAST_CONNECTION, PAST_START)


def test_upgrade_converts_every_naive_column_and_round_trips(scratch_url):
    ids = {key: uuid.uuid4() for key in ("owner", "guest", "visible", "future")}
    _must(scratch_url, "upgrade", "0021")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        _seed(connection, ids)
        policies_before = connection.execute(text(POLICIES)).all()
        assert connection.execute(text(NAIVE_COLUMNS)).scalars().all()
    _assert_guest_behaviour(engine, ids)
    engine.dispose()

    _must(scratch_url, "upgrade", "0022")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert connection.execute(text(NAIVE_COLUMNS)).scalars().all() == []
        # Naive values were UTC wall clocks: the instants are unchanged.
        _assert_wall_clocks(connection, ids, lambda column: f"{column} AT TIME ZONE 'UTC'")
        assert connection.execute(text(POLICIES)).all() == policies_before
        assert connection.scalar(text(
            "SELECT has_column_privilege('ai_readonly', 'public.device', 'last_connection', 'SELECT') "
            "AND has_column_privilege('ai_readonly', 'public.scoped_guest_relation', 'access_starts_at', 'SELECT') "
            "AND has_table_privilege('ai_readonly', 'ai_read.devices', 'SELECT') "
            "AND has_function_privilege('ai_readonly', 'ai_read.telemetry_visible(uuid, uuid, timestamptz)', 'EXECUTE') "
            "AND NOT has_function_privilege('public', 'ai_read.telemetry_visible(uuid, uuid, timestamptz)', 'EXECUTE')"
        ))
        assert connection.scalar(text(
            "SELECT reloptions FROM pg_class WHERE oid = 'ai_read.devices'::regclass"
        )) == ["security_invoker=true"]
        definition = connection.scalar(text(
            "SELECT pg_get_functiondef('ai_read.telemetry_visible'::regproc)"
        ))
        assert "SECURITY DEFINER" in definition and "AT TIME ZONE" not in definition
    _assert_guest_behaviour(engine, ids)
    engine.dispose()

    _must(scratch_url, "downgrade", "0021")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        naive = set(connection.execute(text(NAIVE_COLUMNS)).scalars())
        assert {"public.user.created_at", "public.device.last_connection",
                "public.scoped_guest_relation.access_starts_at", "ai_read.devices.last_connection"} <= naive
        _assert_wall_clocks(connection, ids, lambda column: column)
        assert connection.execute(text(POLICIES)).all() == policies_before
        assert "AT TIME ZONE 'UTC'" in connection.scalar(text(
            "SELECT pg_get_functiondef('ai_read.telemetry_visible'::regproc)"
        ))
    _assert_guest_behaviour(engine, ids)
    engine.dispose()

    _must(scratch_url, "upgrade", "head")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        assert connection.execute(text(NAIVE_COLUMNS)).scalars().all() == []
    engine.dispose()
