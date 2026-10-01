"""Text-to-SQL database layer on real PostgreSQL with a NOSUPERUSER NOBYPASSRLS login.

Proves the security model of migration 0012: generated SQL runs as the NOLOGIN
``ai_readonly`` role *inside the asking user's RLS identity*, over
``security_invoker`` views, so tenants never see each other's rows even though
the application role itself may bypass RLS.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.assistant.catalog import SCHEMA, VIEWS
from app.api.assistant.sql_executor import QueryFailed, QueryResult, execute_validated_sql, run_trusted_query
from app.api.assistant.sql_guard import ValidatedSQL, validate_sql

RLS_TEST_ROLE = "ceiot_rls_test"  # provisioned by tests/postgres/conftest.py

pytestmark = pytest.mark.asyncio

NOW = datetime.now(timezone.utc).replace(microsecond=0)


@dataclass(frozen=True)
class World:
    owner_a: str
    owner_b: str
    guest: str
    admin: str
    stranger: str
    device_a: str
    device_b: str
    env_a: str
    guest_start: datetime


def _json(temperature: float, humidity: float | None = None) -> str:
    body = {"temperature": temperature}
    if humidity is not None:
        body["relative_humidity"] = humidity
    return '{"dht22_1": %s, "ghost": {"temperature": 99}, "bad": 5}' % str(body).replace("'", '"')


@pytest_asyncio.fixture
async def world(postgres_rls_config) -> AsyncIterator[World]:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    sfx = uuid.uuid4().hex[:10]
    ids = {name: uuid.uuid4() for name in (
        "owner_a", "owner_b", "guest", "admin", "stranger", "country", "state", "city", "etype",
        "env_a", "env_b", "dev_a", "dev_b", "rel")}
    guest_start = NOW - timedelta(hours=1)
    async with admin_engine.begin() as c:
        await c.execute(text(f"GRANT ai_readonly TO {RLS_TEST_ROLE}"))
        for key, flag in (("owner_a", False), ("owner_b", False), ("guest", False), ("admin", True), ("stranger", False)):
            await c.execute(text(
                'INSERT INTO "user" (id, email, username, password, first_name, last_name, permissions, created_at, '
                "is_active, is_verified, is_admin, must_change_password, is_social_auth) "
                "VALUES (:id, :e, :u, 'x', 'N', 'L', '[]', now(), true, true, :a, false, false)"),
                {"id": ids[key], "e": f"{key}-{sfx}@example.com", "u": f"{key}-{sfx}", "a": flag})
        await c.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, 'Argentina', true)"), {"i": ids["country"]})
        await c.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, 'Santa Fe', :c, true)"),
                        {"i": ids["state"], "c": ids["country"]})
        await c.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) VALUES (:i, 'Rosario', '2000', :s, true)"),
                        {"i": ids["city"], "s": ids["state"]})
        await c.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:i, 'Oficina', true)"), {"i": ids["etype"]})
        for env, owner, name in (("env_a", "owner_a", f"Sala A {sfx}"), ("env_b", "owner_b", f"Sala B {sfx}")):
            await c.execute(text(
                "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, is_public_map_visible) "
                "VALUES (:i, :n, 'SECRET street 1', 'SECRET loc', 'SECRET desc', :c, :t, true, false)"),
                {"i": ids[env], "n": name, "c": ids["city"], "t": ids["etype"]})
            await c.execute(text(
                "INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) VALUES (:i, :e, :u, true, true)"),
                {"i": uuid.uuid4(), "e": ids[env], "u": ids[owner]})
        dtype = (await c.execute(text("SELECT id FROM device_type WHERE code = 'environmental'"))).scalar_one()
        for dev, env, serial in (("dev_a", "env_a", f"AIA-{sfx}"), ("dev_b", "env_b", f"AIB-{sfx}")):
            await c.execute(text(
                "INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, environment_id, device_type_id, "
                "ip_address, mac_address, wifi_ssid, gps_latitude, gps_longitude) "
                "VALUES (:i, :s, :n, 'ACTIVE', true, true, false, :e, :t, '10.9.9.9', 'AA:BB', 'SECRET-WIFI', -32.9, -60.6)"),
                {"i": ids[dev], "s": serial, "n": f"Equipo {serial}", "e": ids[env], "t": dtype})
        dht22 = (await c.execute(text("SELECT id FROM sensor WHERE code = 'dht22'"))).scalar_one()
        for dev, key in (("dev_a", "dht22_1"), ("dev_b", "dht22_1")):
            await c.execute(text("INSERT INTO device_sensor (id, device_id, sensor_id, key) VALUES (:i, :d, :s, :k)"),
                            {"i": uuid.uuid4(), "d": ids[dev], "s": dht22, "k": key})
        rows = (
            ("dev_a", f"AIA-{sfx}", NOW - timedelta(days=3), 18.0, 40.0),
            ("dev_a", f"AIA-{sfx}", NOW - timedelta(minutes=30), 21.5, 55.0),
            ("dev_a", f"AIA-{sfx}", NOW - timedelta(minutes=10), 22.5, None),
            ("dev_b", f"AIB-{sfx}", NOW - timedelta(minutes=20), 30.0, 70.0),
        )
        for dev, serial, when, temperature, humidity in rows:
            await c.execute(text(
                'INSERT INTO telemetry (time, id, device_id, device_serial, "values") VALUES (:t, :i, :d, :s, CAST(:v AS jsonb))'),
                {"t": when, "i": uuid.uuid4(), "d": ids[dev], "s": serial, "v": _json(temperature, humidity)})
        await c.execute(text(
            "INSERT INTO scoped_guest_relation (id, owner_user_id, guest_user_id, scope_type, scope_id, access_starts_at, "
            "is_active, created_at) VALUES (:i, :o, :g, 'environment', :e, :s, true, now())"),
            {"i": ids["rel"], "o": ids["owner_a"], "g": ids["guest"], "e": ids["env_a"],
             "s": guest_start.astimezone(timezone.utc).replace(tzinfo=None)})
    try:
        yield World(owner_a=str(ids["owner_a"]), owner_b=str(ids["owner_b"]), guest=str(ids["guest"]),
                    admin="system_admin", stranger=str(ids["stranger"]), device_a=f"AIA-{sfx}",
                    device_b=f"AIB-{sfx}", env_a=f"Sala A {sfx}", guest_start=guest_start)
    finally:
        async with admin_engine.begin() as c:
            await c.execute(text("DELETE FROM scoped_guest_relation WHERE id = :i"), {"i": ids["rel"]})
            await c.execute(text("DELETE FROM telemetry WHERE device_id IN (:a, :b)"), {"a": ids["dev_a"], "b": ids["dev_b"]})
            await c.execute(text("DELETE FROM device_sensor WHERE device_id IN (:a, :b)"), {"a": ids["dev_a"], "b": ids["dev_b"]})
            await c.execute(text("DELETE FROM device WHERE id IN (:a, :b)"), {"a": ids["dev_a"], "b": ids["dev_b"]})
            await c.execute(text("DELETE FROM environmentuser WHERE environment_id IN (:a, :b)"), {"a": ids["env_a"], "b": ids["env_b"]})
            await c.execute(text("DELETE FROM environment WHERE id IN (:a, :b)"), {"a": ids["env_a"], "b": ids["env_b"]})
            await c.execute(text('DELETE FROM "user" WHERE id IN (:a, :b, :c, :d, :e)'),
                            {k: ids[v] for k, v in zip("abcde", ("owner_a", "owner_b", "guest", "admin", "stranger"))})
            await c.execute(text("DELETE FROM locationcity WHERE id = :i"), {"i": ids["city"]})
            await c.execute(text("DELETE FROM locationstate WHERE id = :i"), {"i": ids["state"]})
            await c.execute(text("DELETE FROM locationcountry WHERE id = :i"), {"i": ids["country"]})
            await c.execute(text("DELETE FROM environmenttype WHERE id = :i"), {"i": ids["etype"]})
        await admin_engine.dispose()


async def _rows(engine, identity: str, sql: str) -> QueryResult:
    return await execute_validated_sql(engine, identity, validate_sql(sql))


TELEMETRY_COUNT = "SELECT COUNT(*) AS n FROM ai_read.telemetry WHERE device_serial = '{serial}' LIMIT 1"
ALL_MINE = "SELECT device_serial, value, variable FROM ai_read.telemetry ORDER BY value LIMIT 200"


async def test_owner_sees_only_own_flattened_numeric_rows(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await _rows(engine, world.owner_a, ALL_MINE)
    assert {r["device_serial"] for r in result.rows} == {world.device_a}
    # 3 readings: temperature x3 + humidity x2; ghost sensor + non-object 'bad' are excluded or unnamed
    own = [r for r in result.rows if r["variable"] == "temperature" and r["value"] < 90]
    assert sorted(float(r["value"]) for r in own) == [18.0, 21.5, 22.5]
    assert all(isinstance(r["value"], (int, float)) or hasattr(r["value"], "as_tuple") for r in result.rows)


async def test_view_resolves_names_and_units_without_leaking_sensitive_columns(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await _rows(engine, world.owner_a,
        "SELECT device_name, environment_name, sensor_key, sensor_model_code, sensor_model, variable, "
        "variable_name, unit FROM ai_read.telemetry WHERE variable = 'temperature' AND sensor_key = 'dht22_1' LIMIT 1")
    row = result.rows[0]
    assert row["environment_name"] == world.env_a
    assert row["sensor_model_code"] == "dht22" and row["sensor_model"] == "DHT22"
    assert row["variable_name"] == "Temperatura" and row["unit"] == "°C"
    environments = await _rows(engine, world.owner_a, "SELECT * FROM ai_read.environments LIMIT 10")
    assert set(environments.columns) == set(VIEWS["environments"])  # no address/phone/coordinates
    devices = await _rows(engine, world.owner_a, "SELECT * FROM ai_read.devices LIMIT 10")
    assert set(devices.columns) == set(VIEWS["devices"])
    assert not any("SECRET" in str(v) or "10.9.9.9" in str(v) for r in devices.rows + environments.rows for v in r.values())


async def test_other_owner_never_sees_foreign_rows(rls_engine_factory, world):
    engine = rls_engine_factory()
    mine = await _rows(engine, world.owner_b, ALL_MINE)
    assert {r["device_serial"] for r in mine.rows} == {world.device_b}
    foreign = await _rows(engine, world.owner_b, TELEMETRY_COUNT.format(serial=world.device_a))
    assert foreign.rows[0]["n"] == 0
    devices = await _rows(engine, world.owner_b, "SELECT serial FROM ai_read.devices LIMIT 50")
    assert {r["serial"] for r in devices.rows} == {world.device_b}
    sensors = await _rows(engine, world.owner_b, "SELECT device_serial FROM ai_read.sensors LIMIT 50")
    assert {r["device_serial"] for r in sensors.rows} == {world.device_b}


@pytest.mark.parametrize("identity", ["", "nobody", "00000000-0000-0000-0000-000000000000"])
async def test_unknown_or_empty_identity_sees_nothing(rls_engine_factory, world, identity):
    engine = rls_engine_factory()
    for view in ("telemetry", "devices", "environments", "sensors"):
        result = await _rows(engine, identity, f"SELECT COUNT(*) AS n FROM ai_read.{view} LIMIT 1")
        assert result.rows[0]["n"] == 0, view


async def test_guest_sees_only_rows_after_the_access_window(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await _rows(engine, world.guest,
        f"SELECT measured_at, value FROM ai_read.telemetry WHERE device_serial = '{world.device_a}' "
        "AND variable = 'temperature' AND sensor_key = 'dht22_1' ORDER BY measured_at LIMIT 50")
    assert sorted(float(r["value"]) for r in result.rows) == [21.5, 22.5]  # the 3-day-old reading is hidden
    assert all(r["measured_at"] >= world.guest_start for r in result.rows)
    other = await _rows(engine, world.guest, TELEMETRY_COUNT.format(serial=world.device_b))
    assert other.rows[0]["n"] == 0


async def test_admin_identity_sees_every_tenant(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await _rows(engine, world.admin, "SELECT device_serial, COUNT(*) AS n FROM ai_read.telemetry "
                         "GROUP BY device_serial ORDER BY device_serial LIMIT 200")
    seen = {r["device_serial"]: r["n"] for r in result.rows}
    assert world.device_a in seen and world.device_b in seen


async def test_like_percent_and_colon_literals_reach_postgres_verbatim(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await _rows(engine, world.owner_a,
        "SELECT COUNT(*) AS n FROM ai_read.devices WHERE name LIKE '%Equipo%' AND serial <> '12:30' LIMIT 1")
    assert result.rows[0]["n"] == 1


async def test_the_application_login_bypass_is_dropped_by_set_role(postgres_rls_config, world):
    """The dev app role is a superuser with BYPASSRLS: only SET LOCAL ROLE makes RLS apply."""
    engine = create_async_engine(postgres_rls_config.admin_url)
    try:
        sup = (await _rows(engine, world.owner_b, ALL_MINE)).rows
        assert {r["device_serial"] for r in sup} == {world.device_b}
        async with engine.connect() as raw:
            bypass = (await raw.execute(text("SELECT count(*) FROM telemetry"))).scalar_one()
        assert bypass >= 4  # same login without SET ROLE reads every tenant
    finally:
        await engine.dispose()


async def test_ai_readonly_cannot_touch_base_tables_it_was_not_granted(rls_engine_factory, world):
    engine = rls_engine_factory()
    for sql in (
        "SELECT * FROM public.document",
        'SELECT password FROM public."user"',
        'SELECT email FROM public."user"',
        "SELECT * FROM public.scoped_guest_invitation",
        "SELECT * FROM public.assistant_query_log",
        "INSERT INTO public.telemetry (id, device_serial, \"values\") VALUES (gen_random_uuid(), 'x', '{}')",
        "DELETE FROM public.device",
        "CREATE TABLE ai_read.x (a int)",
        "CREATE TEMP TABLE x (a int)",
        "SELECT pg_read_file('/etc/passwd')",
    ):
        with pytest.raises(QueryFailed):
            await run_trusted_query(engine, world.admin, sql)


async def test_even_if_the_guard_were_bypassed_rls_still_isolates_base_columns(rls_engine_factory, world):
    """Second layer evidence: base telemetry columns are granted, but RLS follows the asking identity."""
    engine = rls_engine_factory()
    result = await run_trusted_query(engine, world.owner_b, 'SELECT device_serial FROM public.telemetry')
    assert {r["device_serial"] for r in result.rows} == {world.device_b}


async def test_statement_timeout_aborts_and_connection_is_clean_afterwards(rls_engine_factory, world):
    engine = rls_engine_factory(pool_size=1)
    with pytest.raises(QueryFailed) as caught:
        await run_trusted_query(engine, world.owner_a, "SELECT pg_sleep(2)", statement_timeout_ms=100)
    assert caught.value.code == "timeout"
    async with engine.connect() as conn:
        user = (await conn.execute(text("SELECT current_user"))).scalar_one()
        identity = (await conn.execute(text("SELECT current_setting('app.current_user_id', true)"))).scalar_one()
        readonly = (await conn.execute(text("SHOW transaction_read_only"))).scalar_one()
    assert user == RLS_TEST_ROLE
    assert not identity
    assert readonly == "off"


async def test_row_cap_truncates_and_flags(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await run_trusted_query(engine, world.owner_a, "SELECT g AS n FROM generate_series(1, 500) AS g", max_rows=200)
    assert len(result.rows) == 200 and result.truncated is True


async def test_byte_cap_truncates_and_flags(rls_engine_factory, world):
    engine = rls_engine_factory()
    result = await run_trusted_query(engine, world.owner_a,
        "SELECT repeat('x', 1000) AS s FROM generate_series(1, 150)", max_bytes=10_000)
    assert result.truncated is True and 0 < len(result.rows) < 150 and result.byte_count <= 10_000


async def test_execute_requires_a_validated_object_and_revalidates(rls_engine_factory, world):
    engine = rls_engine_factory()
    with pytest.raises(TypeError):
        await execute_validated_sql(engine, world.owner_a, "SELECT 1")  # type: ignore[arg-type]
    good = validate_sql("SELECT code FROM ai_read.variables LIMIT 1")
    forged = object.__new__(ValidatedSQL)
    object.__setattr__(forged, "sql", "SELECT pg_sleep(1) FROM ai_read.variables LIMIT 1")
    object.__setattr__(forged, "view", good.view)
    object.__setattr__(forged, "limit", 1)
    object.__setattr__(forged, "_issuer", good._issuer)
    from app.api.assistant.sql_guard import SQLRejected
    with pytest.raises(SQLRejected):
        await execute_validated_sql(engine, world.owner_a, forged)


async def test_views_match_the_in_code_catalog_and_are_security_invoker(postgres_rls_config):
    engine = create_async_engine(postgres_rls_config.admin_url)
    try:
        async with engine.connect() as c:
            for view, columns in VIEWS.items():
                found = (await c.execute(text(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = :s AND table_name = :v "
                    "ORDER BY ordinal_position"), {"s": SCHEMA, "v": view})).scalars().all()
                assert found == list(columns), view
            options = dict((await c.execute(text(
                "SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'ai_read' AND c.relkind = 'v'"))).all())
            assert set(options) == set(VIEWS)
            assert all("security_invoker=true" in (opts or []) for opts in options.values())
            role = (await c.execute(text(
                "SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb "
                "FROM pg_roles WHERE rolname = 'ai_readonly'"))).one()
            assert tuple(role) == (False, False, False, False, False, False)
    finally:
        await engine.dispose()


async def test_without_set_role_the_login_cannot_read_ai_read(rls_engine_factory, world):
    engine = rls_engine_factory()
    async with engine.connect() as conn:
        with pytest.raises(Exception, match="permission denied"):
            await conn.execute(text("SELECT 1 FROM ai_read.devices"))


async def test_executor_refuses_stacked_statements_even_for_trusted_sql(rls_engine_factory, world):
    """Defense in depth: the driver would run 'SELECT 1; RESET ROLE' and leave the sandbox."""
    engine = rls_engine_factory()
    with pytest.raises(QueryFailed) as caught:
        await run_trusted_query(engine, world.owner_a, "SELECT 1; RESET ROLE")
    assert caught.value.code == "rejected"
