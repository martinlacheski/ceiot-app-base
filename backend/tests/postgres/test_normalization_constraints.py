"""PostgreSQL contract for the N1 normalization migrations (0015-0017)."""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def admin(postgres_rls_config):
    engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        await engine.dispose()


def _suffix() -> str:
    return uuid.uuid4().hex[:10]


async def _scalar(engine, sql: str, **params):
    async with engine.connect() as connection:
        return (await connection.execute(text(sql), params)).scalar()


async def _seed_hierarchy(connection, suffix: str) -> dict[str, uuid.UUID]:
    ids = {name: uuid.uuid4() for name in ("country", "state", "city", "type", "user", "env", "device")}
    await connection.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:id, :n, true)"),
                             {"id": ids["country"], "n": f"Pais {suffix}"})
    await connection.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:id, :n, :c, true)"),
                             {"id": ids["state"], "n": f"Prov {suffix}", "c": ids["country"]})
    await connection.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) VALUES (:id, :n, '1', :s, true)"),
                             {"id": ids["city"], "n": f"Ciudad {suffix}", "s": ids["state"]})
    await connection.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:id, :n, true)"),
                             {"id": ids["type"], "n": f"Tipo {suffix}"})
    await connection.execute(text(
        "INSERT INTO \"user\" (id, email, username, password, first_name, last_name, created_at, is_active, is_admin, "
        "must_change_password, is_social_auth) VALUES (:id, :e, :u, 'x', 'a', 'b', now(), true, false, false, false)"),
        {"id": ids["user"], "e": f"{suffix}@example.com", "u": f"u{suffix}"})
    await connection.execute(text(
        "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, is_public_map_visible) "
        "VALUES (:id, :n, 'addr', :loc, 'd', :city, :type, true, false)"),
        {"id": ids["env"], "n": f"Env {suffix}", "loc": "-31.4167,-64.1833", "city": ids["city"], "type": ids["type"]})
    return ids


async def _cleanup(engine, ids: dict[str, uuid.UUID]):
    async with engine.begin() as connection:
        await connection.execute(text("ALTER TABLE deviceoperation DISABLE ROW LEVEL SECURITY"))
        await connection.execute(text("DELETE FROM deviceoperation WHERE device_id = :d OR environment_id = :e"),
                                 {"d": ids["device"], "e": ids["env"]})
        await connection.execute(text("ALTER TABLE deviceoperation ENABLE ROW LEVEL SECURITY"))
        await connection.execute(text("ALTER TABLE deviceoperation FORCE ROW LEVEL SECURITY"))
        for sql, key in (
            ("DELETE FROM device WHERE id = :i", "device"),
            ("DELETE FROM environmentuser WHERE environment_id = :i", "env"),
            ("DELETE FROM environment WHERE id = :i", "env"),
            ('DELETE FROM "user" WHERE id = :i', "user"),
            ("DELETE FROM environmenttype WHERE id = :i", "type"),
            ("DELETE FROM locationcity WHERE id = :i", "city"),
            ("DELETE FROM locationstate WHERE id = :i", "state"),
            ("DELETE FROM locationcountry WHERE id = :i", "country"),
        ):
            await connection.execute(text(sql), {"i": ids[key]})


async def test_deviceoperation_has_indexed_nullable_set_null_fk_to_device(admin):
    nullable = await _scalar(
        admin,
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = 'deviceoperation' AND column_name = 'device_id'",
    )
    assert nullable == "YES"
    delete_rule = await _scalar(
        admin,
        "SELECT confdeltype::text FROM pg_constraint WHERE conrelid = 'deviceoperation'::regclass "
        "AND contype = 'f' AND confrelid = 'device'::regclass",
    )
    assert delete_rule == "n"  # ON DELETE SET NULL
    assert await _scalar(
        admin, "SELECT count(*) FROM pg_indexes WHERE tablename = 'deviceoperation' AND indexname = 'ix_deviceoperation_device_id'"
    ) == 1
    assert await _scalar(
        admin,
        "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name = 'deviceoperation'",
    ) == 1


async def test_insert_trigger_resolves_device_id_from_serial_and_keeps_orphans_null(admin):
    suffix = _suffix()
    serial = f"IOT-N1-{suffix}"
    async with admin.begin() as connection:
        ids = await _seed_hierarchy(connection, suffix)
        type_id = await connection.scalar(text("SELECT id FROM device_type LIMIT 1"))
        await connection.execute(
            text("INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, device_type_id, environment_id) "
                 "VALUES (:id, :s, 'n', 'PAIRED', true, true, false, :t, :e)"),
            {"id": ids["device"], "s": serial, "t": type_id, "e": ids["env"]},
        )
        for who in (serial, f"IOT-ORPHAN-{suffix}"):
            await connection.execute(
                text("INSERT INTO deviceoperation (id, device_serial, operation_type, status) "
                     "VALUES (:id, :s, 'KEEP_ACTIVE', 'SUCCESS')"),
                {"id": uuid.uuid4(), "s": who},
            )
    try:
        assert await _scalar(admin, "SELECT device_id FROM deviceoperation WHERE device_serial = :s", s=serial) == ids["device"]
        assert await _scalar(
            admin, "SELECT device_id FROM deviceoperation WHERE device_serial = :s", s=f"IOT-ORPHAN-{suffix}"
        ) is None
        # ON DELETE SET NULL keeps the history row (and its serial) when the device row goes away.
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM device WHERE id = :i"), {"i": ids["device"]})
        assert await _scalar(
            admin, "SELECT count(*) FROM deviceoperation WHERE device_serial = :s AND device_id IS NULL", s=serial
        ) == 1
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("ALTER TABLE deviceoperation DISABLE ROW LEVEL SECURITY"))
            await connection.execute(text("DELETE FROM deviceoperation WHERE device_serial LIKE :p"), {"p": f"%{suffix}"})
            await connection.execute(text("ALTER TABLE deviceoperation ENABLE ROW LEVEL SECURITY"))
            await connection.execute(text("ALTER TABLE deviceoperation FORCE ROW LEVEL SECURITY"))
        await _cleanup(admin, ids)


async def test_one_active_membership_per_user_and_environment(admin):
    suffix = _suffix()
    async with admin.begin() as connection:
        ids = await _seed_hierarchy(connection, suffix)
        await connection.execute(
            text("INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) VALUES (:id, :e, :u, true, true)"),
            {"id": uuid.uuid4(), "e": ids["env"], "u": ids["user"]},
        )
    try:
        with pytest.raises(IntegrityError):
            async with admin.begin() as connection:
                await connection.execute(
                    text("INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) VALUES (:id, :e, :u, false, true)"),
                    {"id": uuid.uuid4(), "e": ids["env"], "u": ids["user"]},
                )
        # Inactive history rows may repeat.
        async with admin.begin() as connection:
            for _ in range(2):
                await connection.execute(
                    text("INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) VALUES (:id, :e, :u, false, false)"),
                    {"id": uuid.uuid4(), "e": ids["env"], "u": ids["user"]},
                )
    finally:
        ids["device"] = uuid.uuid4()
        await _cleanup(admin, ids)


async def test_catalog_names_are_unique_case_insensitively(admin):
    suffix = _suffix()
    async with admin.begin() as connection:
        ids = await _seed_hierarchy(connection, suffix)
    attempts = [
        ("INSERT INTO locationcountry (id, name, is_active) VALUES (:id, :n, true)", {"n": f"PAIS {suffix}"}),
        ("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:id, :n, :p, true)",
         {"n": f"prov {suffix}", "p": ids["country"]}),
        ("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) VALUES (:id, :n, '2', :p, true)",
         {"n": f"CIUDAD {suffix}", "p": ids["state"]}),
        ("INSERT INTO environmenttype (id, name, is_active) VALUES (:id, :n, true)", {"n": f"tipo {suffix}"}),
    ]
    try:
        for sql, params in attempts:
            with pytest.raises(IntegrityError):
                async with admin.begin() as connection:
                    await connection.execute(text(sql), {"id": uuid.uuid4(), **params})
        # Same names under a different parent are fine.
        async with admin.begin() as connection:
            other_country = uuid.uuid4()
            await connection.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:id, :n, true)"),
                                     {"id": other_country, "n": f"Otro {suffix}"})
            await connection.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:id, :n, :c, true)"),
                                     {"id": uuid.uuid4(), "n": f"Prov {suffix}", "c": other_country})
            await connection.execute(text("DELETE FROM locationstate WHERE country_id = :c"), {"c": other_country})
            await connection.execute(text("DELETE FROM locationcountry WHERE id = :c"), {"c": other_country})
    finally:
        ids["device"] = uuid.uuid4()
        await _cleanup(admin, ids)


async def test_environment_coordinate_columns_check_and_backfill_shape(admin):
    suffix = _suffix()
    async with admin.begin() as connection:
        ids = await _seed_hierarchy(connection, suffix)
    try:
        for assignment in ("latitude = 91, longitude = 0", "latitude = 0, longitude = 181", "latitude = 5, longitude = NULL"):
            with pytest.raises(IntegrityError):
                async with admin.begin() as connection:
                    await connection.execute(text(f"UPDATE environment SET {assignment} WHERE id = :i"), {"i": ids["env"]})
        async with admin.begin() as connection:
            await connection.execute(text("UPDATE environment SET latitude = -31.4167, longitude = -64.1833 WHERE id = :i"), {"i": ids["env"]})
        assert await _scalar(
            admin, "SELECT data_type FROM information_schema.columns WHERE table_name='environment' AND column_name='latitude'"
        ) == "double precision"
    finally:
        ids["device"] = uuid.uuid4()
        await _cleanup(admin, ids)
