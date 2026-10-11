"""``device_state`` row level security mirrors ``device``, on a NOSUPERUSER NOBYPASSRLS login.

Every identity sees exactly the state rows of the devices it can see (members and guests read,
strangers and an empty identity see nothing); only members (and the system identities) write,
like ``device_member_access``. The MQTT runtime writes as ``system_mqtt``: its upserts pass RLS
and leave ``device.updated_at`` alone.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.models import Device
from app.api.device.repository import DeviceRepository

pytestmark = pytest.mark.asyncio

EDITED = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)


@dataclass(frozen=True)
class World:
    owner: str
    env_guest: str
    device_guest: str
    stranger: str
    device_id: uuid.UUID
    other_device_id: uuid.UUID
    serial: str


@pytest_asyncio.fixture
async def world(postgres_rls_config) -> AsyncIterator[World]:
    admin = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    sfx = uuid.uuid4().hex[:10].upper()  # serials are stored normalized (upper case)
    ids = {key: uuid.uuid4() for key in (
        "owner", "env_guest", "device_guest", "stranger", "country", "state", "city", "etype", "env", "dev",
        "other_dev")}
    serial = f"IOT-{sfx[:4]}-{sfx[4:8]}"
    async with admin.begin() as c:
        for key in ("owner", "env_guest", "device_guest", "stranger"):
            await c.execute(text(
                'INSERT INTO "user" (id, email, username, password, first_name, last_name, permissions, '
                "created_at, is_active, is_verified, is_admin, must_change_password, is_social_auth) "
                "VALUES (:id, :e, :u, 'x', 'N', 'L', '[]', now(), true, true, false, false, false)"),
                {"id": ids[key], "e": f"{key}-{sfx}@n4.test", "u": f"{key}-{sfx}"})
        await c.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, :n, true)"),
                        {"i": ids["country"], "n": f"AR {sfx}"})
        await c.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, :n, :c, true)"),
                        {"i": ids["state"], "n": f"Mis {sfx}", "c": ids["country"]})
        await c.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) "
                             "VALUES (:i, :n, '3300', :s, true)"), {"i": ids["city"], "n": f"Pos {sfx}", "s": ids["state"]})
        await c.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:i, :n, true)"),
                        {"i": ids["etype"], "n": f"Lab {sfx}"})
        await c.execute(text(
            "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, "
            "is_public_map_visible) VALUES (:i, :n, 'a', 'l', 'd', :c, :t, true, false)"),
            {"i": ids["env"], "n": f"Sala {sfx}", "c": ids["city"], "t": ids["etype"]})
        await c.execute(text("INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) "
                             "VALUES (:i, :e, :u, true, true)"), {"i": uuid.uuid4(), "e": ids["env"], "u": ids["owner"]})
        dtype = (await c.execute(text("SELECT id FROM device_type WHERE code = 'environmental'"))).scalar_one()
        for key, env, device_serial in (("dev", ids["env"], serial), ("other_dev", None, f"IOT-{sfx[4:8]}-{sfx[:4]}")):
            await c.execute(text(
                "INSERT INTO device (id, serial, name, status, is_active, enabled, device_type_id, environment_id, "
                "updated_at) VALUES (:i, :s, :n, 'ACTIVE', true, true, :t, :e, :u)"),
                {"i": ids[key], "s": device_serial, "n": f"N4 {key} {sfx}", "t": dtype, "e": env, "u": EDITED})
            await c.execute(text(
                "INSERT INTO device_state (device_id, firmware_version, broker_connected, updated_at) "
                "VALUES (:i, '1.0.0', false, now())"), {"i": ids[key]})
        for guest, scope_type, scope_id in (("env_guest", "environment", ids["env"]),
                                            ("device_guest", "device", ids["dev"])):
            await c.execute(text(
                "INSERT INTO scoped_guest_relation (id, owner_user_id, guest_user_id, scope_type, scope_id, "
                "access_starts_at, is_active, created_at) VALUES (:i, :o, :g, :t, :s, :a, true, now())"),
                {"i": uuid.uuid4(), "o": ids["owner"], "g": ids[guest], "t": scope_type, "s": scope_id,
                 "a": datetime.now(timezone.utc) - timedelta(days=1)})
    try:
        yield World(owner=str(ids["owner"]), env_guest=str(ids["env_guest"]), device_guest=str(ids["device_guest"]),
                    stranger=str(ids["stranger"]), device_id=ids["dev"],
                    other_device_id=ids["other_dev"], serial=serial)
    finally:
        async with admin.begin() as c:
            await c.execute(text("DELETE FROM scoped_guest_relation WHERE owner_user_id = :o"), {"o": ids["owner"]})
            await c.execute(text("DELETE FROM device_location_report WHERE device_id IN (:a, :b)"),
                            {"a": ids["dev"], "b": ids["other_dev"]})
            await c.execute(text("DELETE FROM device WHERE id IN (:a, :b)"), {"a": ids["dev"], "b": ids["other_dev"]})
            await c.execute(text("DELETE FROM environmentuser WHERE environment_id = :e"), {"e": ids["env"]})
            await c.execute(text("DELETE FROM environment WHERE id = :e"), {"e": ids["env"]})
            await c.execute(text('DELETE FROM "user" WHERE id IN (:a, :b, :c, :d)'), {
                "a": ids["owner"], "b": ids["env_guest"], "c": ids["device_guest"], "d": ids["stranger"]})
            await c.execute(text("DELETE FROM locationcity WHERE id = :i"), {"i": ids["city"]})
            await c.execute(text("DELETE FROM locationstate WHERE id = :i"), {"i": ids["state"]})
            await c.execute(text("DELETE FROM locationcountry WHERE id = :i"), {"i": ids["country"]})
            await c.execute(text("DELETE FROM environmenttype WHERE id = :i"), {"i": ids["etype"]})
        await admin.dispose()


async def _scalar(engine, identity: str, sql: str, params: dict | None = None):
    async with engine.begin() as c:
        await c.execute(text("SELECT set_config('app.current_user_id', :v, true)"), {"v": identity})
        return (await c.execute(text(sql), params or {})).scalar_one()


async def test_state_visibility_matches_device_visibility_for_every_identity(rls_engine_factory, world):
    engine = rls_engine_factory()
    # Both seeded devices have a state row; filter by id (not through device) so only the
    # device_state policies decide what each identity sees.
    ids = {"ids": [world.device_id, world.other_device_id]}
    devices = "SELECT array_agg(id ORDER BY id::text) FROM device WHERE id = ANY(:ids)"
    states = "SELECT array_agg(device_id ORDER BY device_id::text) FROM device_state WHERE device_id = ANY(:ids)"
    for identity in (world.owner, world.env_guest, world.device_guest, world.stranger, "", "system_mqtt", "system_admin"):
        visible_devices = await _scalar(engine, identity, devices, ids)
        visible_states = await _scalar(engine, identity, states, ids)
        assert visible_states == visible_devices, identity
    assert await _scalar(engine, world.owner, states, ids) == [world.device_id]
    assert await _scalar(engine, world.device_guest, states, ids) == [world.device_id]
    assert await _scalar(engine, world.stranger, states, ids) is None
    assert len(await _scalar(engine, "system_mqtt", states, ids)) == 2


async def test_only_members_and_system_identities_write_state(rls_engine_factory, world):
    engine = rls_engine_factory()
    update = "WITH u AS (UPDATE device_state SET rssi = -1 WHERE device_id = :d RETURNING 1) SELECT count(*) FROM u"
    params = {"d": world.device_id}
    assert await _scalar(engine, world.owner, update, params) == 1
    assert await _scalar(engine, "system_mqtt", update, params) == 1
    for reader in (world.env_guest, world.device_guest, world.stranger, ""):
        assert await _scalar(engine, reader, update, params) == 0, reader
    with pytest.raises(DBAPIError, match="row-level security"):
        await _scalar(engine, world.stranger,
                      "WITH i AS (INSERT INTO device_state (device_id, broker_connected) VALUES (:d, false) "
                      "RETURNING 1) SELECT count(*) FROM i", params)


async def test_runtime_writes_pass_rls_as_system_mqtt_and_leave_device_updated_at(rls_engine_factory, world):
    engine = rls_engine_factory()
    async with engine.connect() as connection:
        await connection.execute(text("SELECT set_config('app.current_user_id', 'system_mqtt', false)"))
        await connection.commit()
        async with AsyncSession(connection, expire_on_commit=False) as session:
            repo = DeviceRepository(session)
            device = await repo.get_by_serial(world.serial)
            await repo.register_runtime_report(device, firmware_version="2.0.0", rssi=-48,
                                               gps_latitude=-27.1, gps_longitude=-55.2)
            presence = await repo.update_broker_presence(world.serial, True)
            assert presence.broker_connected is True

    async with engine.begin() as c:
        await c.execute(text("SELECT set_config('app.current_user_id', 'system_admin', true)"))
        row = (await c.execute(text(
            "SELECT d.updated_at, s.firmware_version, s.rssi, s.gps_latitude, s.broker_connected, "
            "s.last_connection IS NOT NULL AS seen FROM device d JOIN device_state s ON s.device_id = d.id "
            "WHERE d.id = :d"), {"d": world.device_id})).one()
    assert tuple(row) == (EDITED, "2.0.0", -48, -27.1, True, True)


async def test_deleting_a_device_removes_its_state(postgres_rls_config, world):
    admin = create_async_engine(postgres_rls_config.admin_url)
    try:
        async with admin.begin() as c:
            await c.execute(text("DELETE FROM device WHERE id = :d"), {"d": world.device_id})
            remaining = (await c.execute(text("SELECT count(*) FROM device_state WHERE device_id = :d"),
                                         {"d": world.device_id})).scalar_one()
        assert remaining == 0
    finally:
        await admin.dispose()


async def test_device_state_is_a_registered_model():
    assert Device.__table__.name == "device"
    from app.core import model_registry

    assert model_registry.DeviceState.__tablename__ == "device_state"
