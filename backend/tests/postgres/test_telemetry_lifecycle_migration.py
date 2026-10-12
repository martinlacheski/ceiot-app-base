"""Migration 0028: telemetry moves to ``telemetry_store`` with compression, retention and an hourly aggregate.

A throwaway ``<dev_db>_lifecycle`` database is migrated to 0027 and seeded with telemetry (one
row older than the 1-year raw retention, others older than the 7-day compression threshold, one
recent), sensor readings and device operations. It is upgraded (the initial refresh materializes
the whole history), its jobs are run by hand (compression, retention, routine-operation pruning),
downgraded (decompression, policies and grants restored) and upgraded again. It never touches the
dev or the shared test database.
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

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]
NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
# (age, values): the oldest row is beyond the raw retention, three are compressible.
TELEMETRY = [
    (timedelta(days=400, minutes=-10), '{"dht22": {"temperature": 11.0}}'),
    (timedelta(days=30, minutes=-10), '{"dht22": {"temperature": 20.0, "relative_humidity": 40}}'),
    (timedelta(days=30, minutes=-20), '{"dht22": {"temperature": 22.0, "relative_humidity": "bad"}}'),
    (timedelta(days=20, minutes=-5), '{"bmp280": {"pressure": 1000}, "weird": 3}'),
    (timedelta(hours=5, minutes=-5), '{"dht22": {"temperature": 25.5}}'),
]
OPERATIONS = [
    ("SENSOR_DATA", timedelta(days=100)), ("KEEP_ACTIVE", timedelta(days=100)),
    ("MOVE", timedelta(days=100)), ("UNPAIR", timedelta(days=100)), ("ERROR", timedelta(days=100)),
    ("FIRMWARE_UPDATE", timedelta(days=100)), ("SENSOR_DATA", timedelta(days=10)),
]
SERIAL = "IOT-LIFECYCLE-0001"


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_lifecycle"
    scratch = dev_sync.set(database=name)
    maintenance = create_engine(dev_sync, isolation_level="AUTOCOMMIT")
    terminate = ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                 "WHERE datname = %(n)s AND pid <> pg_backend_pid()")
    try:
        with maintenance.connect() as connection:
            connection.exec_driver_sql(terminate, {"n": name})
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    except SQLAlchemyError as exc:
        pytest.skip(f"cannot create the scratch database: {type(exc).__name__}")
    yield scratch
    with maintenance.connect() as connection:
        connection.exec_driver_sql(terminate, {"n": name})
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _alembic(url, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False))
    result = subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-3000:]


def _query(url, sql, params=None):
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params or {}).all()
    finally:
        engine.dispose()


def _call(url, sql):
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(sql))
    finally:
        engine.dispose()


def _scalar(url, sql, params=None):
    return _query(url, sql, params)[0][0]


def _seed(url):
    engine = create_engine(url)
    with engine.begin() as connection:
        for age, values in TELEMETRY:
            connection.execute(text(
                'INSERT INTO telemetry (time, id, device_serial, "values") VALUES (:t, :i, :s, CAST(:v AS jsonb))'
            ), {"t": NOW - age, "i": uuid.uuid4(), "s": SERIAL, "v": values})
            connection.execute(text(
                "INSERT INTO sensorreading (time, id, device_serial) VALUES (:t, :i, :s)"
            ), {"t": NOW - age, "i": uuid.uuid4(), "s": SERIAL})
        for kind, age in OPERATIONS:
            connection.execute(text(
                "INSERT INTO deviceoperation (time, id, device_serial, operation_type, status) "
                "VALUES (:t, :i, :s, CAST(:k AS deviceoperationtype), 'SUCCESS')"
            ), {"t": NOW - age, "i": uuid.uuid4(), "s": SERIAL, "k": kind})
    engine.dispose()


SNAPSHOT_SQL = """
SELECT (SELECT json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles,
                                          'qual', qual, 'check', with_check) ORDER BY policyname)
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'telemetry')::text,
       (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.telemetry'::regclass),
       (SELECT json_agg(attname || ':' || coalesce(attacl::text, '') ORDER BY attnum) FROM pg_attribute
        WHERE attrelid = 'public.telemetry'::regclass AND attnum > 0)::text,
       pg_get_viewdef('ai_read.telemetry'::regclass),
       (SELECT reloptions::text FROM pg_class WHERE oid = 'ai_read.telemetry'::regclass),
       (SELECT relacl::text FROM pg_class WHERE oid = 'ai_read.telemetry'::regclass),
       (SELECT count(*) FROM telemetry),
       (SELECT sum(hashtext(t::text)::bigint) FROM telemetry t)
"""


def _jobs(url):
    """(procedure, hypertable or procedure schema) -> (job id, schedule, config, next start HH:MI UTC)."""
    rows = _query(url, """
        SELECT j.proc_name, coalesce(j.hypertable_schema || '.' || j.hypertable_name, j.proc_schema),
               j.job_id, j.schedule_interval, j.config, to_char(j.next_start AT TIME ZONE 'UTC', 'HH24:MI')
        FROM timescaledb_information.jobs j WHERE j.job_id >= 1000""")
    return {(row[0], row[1]): tuple(row[2:]) for row in rows}


def test_round_trip_moves_compresses_aggregates_and_restores(scratch_url):
    _alembic(scratch_url, "upgrade", "0027")
    _seed(scratch_url)
    before = _query(scratch_url, SNAPSHOT_SQL)[0]
    # Two sum_value contributions are 20 and 22 in the same hour; the "bad" humidity is ignored.
    raw_hourly = _query(scratch_url, """
        SELECT time_bucket('1 hour', t.time), s.key, v.key, sum((v.value #>> '{}')::numeric), count(*)
        FROM telemetry t CROSS JOIN LATERAL jsonb_each(t."values") s(key, value)
        CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{}' END) v(key, value)
        WHERE jsonb_typeof(v.value) = 'number' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""")

    _alembic(scratch_url, "upgrade", "0028")

    assert _scalar(scratch_url, "SELECT to_regclass('telemetry_store.telemetry') IS NOT NULL")
    assert _scalar(scratch_url, "SELECT relkind FROM pg_class WHERE oid = 'public.telemetry'::regclass") == "v"
    assert _scalar(scratch_url, "SELECT count(*) FROM pg_policies WHERE tablename = 'telemetry'") == 0
    assert _scalar(scratch_url, "SELECT count(*) FROM telemetry_store.telemetry") == len(TELEMETRY)
    # The initial refresh materialized the whole history (real time covers the last hour only).
    materialized = _query(scratch_url, """
        SELECT bucket, sensor_key, variable, sum_value, readings FROM telemetry_store.telemetry_hourly
        ORDER BY 1, 2, 3""")
    assert [tuple(row) for row in materialized] == [tuple(row) for row in raw_hourly]

    jobs = _jobs(scratch_url)
    assert len(jobs) == 6
    raw_retention = jobs[("policy_retention", "telemetry_store.telemetry")]
    assert (raw_retention[1], raw_retention[2]["drop_after"], raw_retention[3]) == (timedelta(days=1), "1 year", "07:00")
    readings_retention = jobs[("policy_retention", "public.sensorreading")]
    assert (readings_retention[2]["drop_after"], readings_retention[3]) == ("90 days", "07:20")
    prune = jobs[("prune_routine_device_operations", "telemetry_store")]
    assert (prune[1], prune[2], prune[3]) == (timedelta(days=1), {"drop_after": "90 days"}, "07:40")
    raw_compression = jobs[("policy_compression", "telemetry_store.telemetry")]
    assert (raw_compression[2]["compress_after"], raw_compression[3]) == ("7 days", "08:00")
    cagg_jobs = {name: value for (name, target), value in jobs.items() if target == "telemetry_store.telemetry_hourly"}
    assert set(cagg_jobs) == {"policy_refresh_continuous_aggregate", "policy_compression"}, jobs
    refresh = cagg_jobs["policy_refresh_continuous_aggregate"]
    assert refresh[1] == timedelta(minutes=30)
    assert (refresh[2]["start_offset"], refresh[2]["end_offset"]) == ("3 days", "01:00:00")
    assert cagg_jobs["policy_compression"][3] == "08:20"
    settings_rows = _query(scratch_url, """
        SELECT hypertable_schema = 'telemetry_store', attname, segmentby_column_index, orderby_column_index,
               orderby_asc FROM timescaledb_information.compression_settings ORDER BY 1, 2""")
    assert [tuple(row) for row in settings_rows] == [
        (False, "bucket", None, 1, False), (False, "device_id", 1, None, None),
        (True, "device_id", 1, None, None), (True, "id", None, 2, True), (True, "time", None, 1, False)]

    # Compression, then the jobs that delete: raw beyond one year goes, its hourly rollup stays.
    _call(scratch_url, f"CALL run_job({raw_compression[0]})")
    assert _scalar(scratch_url, """SELECT count(*) FROM timescaledb_information.chunks
        WHERE hypertable_schema = 'telemetry_store' AND hypertable_name = 'telemetry' AND is_compressed""") >= 2
    assert _scalar(scratch_url, "SELECT count(*) FROM telemetry") == len(TELEMETRY)
    _call(scratch_url, f"CALL run_job({raw_retention[0]})")
    _call(scratch_url, f"CALL run_job({readings_retention[0]})")
    _call(scratch_url, f"CALL run_job({prune[0]})")
    assert _scalar(scratch_url, "SELECT count(*) FROM telemetry_store.telemetry") == len(TELEMETRY) - 1
    assert _scalar(scratch_url, "SELECT min(bucket) FROM telemetry_store.telemetry_hourly") == raw_hourly[0][0]
    assert _scalar(scratch_url, "SELECT count(*) FROM sensorreading") == len(TELEMETRY) - 1
    kinds = sorted(row[0] for row in _query(scratch_url, "SELECT operation_type::text FROM deviceoperation"))
    assert kinds == ["ERROR", "FIRMWARE_UPDATE", "MOVE", "SENSOR_DATA", "UNPAIR"]

    _alembic(scratch_url, "downgrade", "0027")

    after = _query(scratch_url, SNAPSHOT_SQL)[0]
    assert after[:6] == before[:6]
    assert after[6] == len(TELEMETRY) - 1
    assert _scalar(scratch_url, "SELECT to_regnamespace('telemetry_store') IS NULL")
    assert _scalar(scratch_url, "SELECT count(*) FROM timescaledb_information.jobs WHERE job_id >= 1000") == 0
    assert _scalar(scratch_url, """SELECT compression_enabled FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'telemetry'""") is False
    assert _scalar(scratch_url, "SELECT hypertable_schema FROM timescaledb_information.hypertables "
                                "WHERE hypertable_name = 'telemetry'") == "public"

    _alembic(scratch_url, "upgrade", "head")
    assert _scalar(scratch_url, "SELECT count(*) FROM telemetry_store.telemetry") == len(TELEMETRY) - 1
    assert _scalar(scratch_url, "SELECT count(*) FROM timescaledb_information.jobs WHERE job_id >= 1000") == 6
