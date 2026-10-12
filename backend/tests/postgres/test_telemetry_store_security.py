"""Telemetry without RLS (migration 0028): views, write guard and private storage, as ``ceiot_rls_test``.

``public.telemetry`` and ``public.telemetry_hourly`` must show exactly what the former
``device_data_access`` policy showed (owner/member, admin, system identities, guests), with the
guest window applied per row (``access_starts_at <= time``/``bucket``). Writes are only allowed to
the ingestion identities, and no application role reaches ``telemetry_store`` or the TimescaleDB
internals (chunks, compressed chunks, materialization) directly.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.environment.environment.models import EnvironmentUser
from app.api.sensor.models import Telemetry
from telemetry_rollup import refresh_hourly
from test_device_history_environment_snapshot import history_rows  # noqa: F401

pytestmark = pytest.mark.asyncio

T1 = datetime(2025, 12, 1, 10, 0, tzinfo=timezone.utc)   # old environment, before every guest window
T2 = datetime(2025, 12, 1, 12, 30, tzinfo=timezone.utc)  # old environment
T3 = datetime(2025, 12, 2, 9, 0, tzinfo=timezone.utc)    # new environment (after the move)
ENV_GUEST_FROM = datetime(2025, 12, 1, 12, 0, tzinfo=timezone.utc)
DEVICE_GUEST_FROM = datetime(2025, 12, 1, 11, 0, tzinfo=timezone.utc)
WINDOW = (datetime(2025, 12, 1, tzinfo=timezone.utc), datetime(2025, 12, 3, tzinfo=timezone.utc))
ALL_PRIVILEGES = "SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER"


def _user(tag: str, **extra) -> User:
    suffix = uuid.uuid4().hex
    return User(email=f"store-{tag}-{suffix}@example.com", username=f"store-{tag}-{suffix}",
                password="unused", is_verified=True, **extra)


@pytest_asyncio.fixture
async def world(postgres_rls_config, history_rows):  # noqa: F811
    """Three telemetry rows (two in the old environment, one after moving) and every kind of reader."""
    admin = create_async_engine(postgres_rls_config.admin_url)
    users = {tag: _user(tag, **extra) for tag, extra in {
        "env_guest": {}, "device_guest": {}, "inactive_guest": {}, "future_guest": {},
        "inactive_member": {}, "other": {}, "admin": {"is_admin": True}}.items()}
    relations = [
        ScopedGuestRelation(owner_user_id=history_rows.old_owner_id, guest_user_id=users["env_guest"].id,
                            scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
                            access_starts_at=ENV_GUEST_FROM),
        ScopedGuestRelation(owner_user_id=history_rows.old_owner_id, guest_user_id=users["device_guest"].id,
                            scope_type=ScopeType.DEVICE, scope_id=history_rows.device_id,
                            access_starts_at=DEVICE_GUEST_FROM),
        ScopedGuestRelation(owner_user_id=history_rows.old_owner_id, guest_user_id=users["inactive_guest"].id,
                            scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
                            access_starts_at=ENV_GUEST_FROM, is_active=False),
        ScopedGuestRelation(owner_user_id=history_rows.old_owner_id, guest_user_id=users["future_guest"].id,
                            scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
                            access_starts_at=datetime.now(timezone.utc) + timedelta(days=1)),
    ]
    membership = EnvironmentUser(environment_id=history_rows.old_environment_id,
                                 user_id=users["inactive_member"].id, is_owner=False, is_active=False)
    rows = {"t1": uuid.uuid4(), "t2": uuid.uuid4(), "t3": uuid.uuid4()}
    insert = text('INSERT INTO telemetry (time, id, device_id, device_serial, "values") '
                  "VALUES (:time, :id, :device, :serial, CAST(:values AS jsonb))")
    try:
        async with AsyncSession(admin, expire_on_commit=False) as setup:
            setup.add_all(users.values())
            await setup.flush()
            setup.add_all([*relations, membership])
            await setup.commit()
        async with admin.begin() as connection:
            for key, when, value in (("t1", T1, 20), ("t2", T2, 22)):
                await connection.execute(insert, {"time": when, "id": rows[key], "device": history_rows.device_id,
                    "serial": history_rows.device_serial, "values": f'{{"dht22":{{"temperature":{value}}}}}'})
            await connection.execute(text("UPDATE device SET environment_id = :env WHERE id = :id"),
                                     {"env": history_rows.new_environment_id, "id": history_rows.device_id})
            await connection.execute(insert, {"time": T3, "id": rows["t3"], "device": history_rows.device_id,
                "serial": history_rows.device_serial, "values": '{"dht22":{"temperature":24}}'})
        await refresh_hourly(postgres_rls_config.admin_url, *WINDOW)
        readers = {tag: str(user.id) for tag, user in users.items()}
        readers.update(old_owner=str(history_rows.old_owner_id), new_owner=str(history_rows.new_owner_id),
                       system_mqtt="system_mqtt", system_admin="system_admin", empty="", unset=None)
        yield {"rows": rows, "readers": readers, "history": history_rows, "admin": admin}
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM telemetry WHERE device_id = :id"), {"id": history_rows.device_id})
            await connection.execute(text("UPDATE device SET environment_id = :env WHERE id = :id"),
                                     {"env": history_rows.old_environment_id, "id": history_rows.device_id})
            await connection.execute(text("DELETE FROM scoped_guest_relation WHERE id = ANY(:ids)"),
                                     {"ids": [relation.id for relation in relations]})
            await connection.execute(text("DELETE FROM environmentuser WHERE id = :id"), {"id": membership.id})
            await connection.execute(text('DELETE FROM "user" WHERE id = ANY(:ids)'),
                                     {"ids": [user.id for user in users.values()]})
        await refresh_hourly(postgres_rls_config.admin_url, *WINDOW)
        await admin.dispose()


async def _as(session, identity):
    if identity is not None:
        await session.execute(text("SELECT set_config('app.current_user_id', :id, true)"), {"id": identity})


# reader -> rows of public.telemetry it sees (the former policy plus the per-row guest window).
EXPECTED_ROWS = {
    "old_owner": {"t1", "t2"},
    "new_owner": {"t3"},
    "env_guest": {"t2"},             # the old policy showed t1 too (window checked against now())
    "device_guest": {"t2", "t3"},    # device scope follows the device across environments
    "inactive_guest": set(),
    "future_guest": set(),
    "inactive_member": set(),
    "other": set(),
    "empty": set(),
    "unset": set(),
    "admin": {"t1", "t2", "t3"},
    "system_mqtt": {"t1", "t2", "t3"},
    "system_admin": {"t1", "t2", "t3"},
}
# reader -> hourly buckets of public.telemetry_hourly it sees (guest: access_starts_at <= bucket).
EXPECTED_BUCKETS = {
    "old_owner": {T1, T2.replace(minute=0)},
    "new_owner": {T3},
    "env_guest": {T2.replace(minute=0)},
    "device_guest": {T2.replace(minute=0), T3},
    "inactive_guest": set(), "future_guest": set(), "inactive_member": set(), "other": set(),
    "empty": set(), "unset": set(),
    "admin": {T1, T2.replace(minute=0), T3},
    "system_mqtt": {T1, T2.replace(minute=0), T3},
    "system_admin": {T1, T2.replace(minute=0), T3},
}


async def test_views_show_what_the_policy_showed_with_the_guest_window_per_row(world, rls_engine_factory):
    role = rls_engine_factory()
    by_id = {value: key for key, value in world["rows"].items()}
    device = world["history"].device_id
    seen_rows, seen_buckets = {}, {}
    async with AsyncSession(role) as session:
        for reader, identity in world["readers"].items():
            await _as(session, identity)
            ids = (await session.execute(text("SELECT id FROM telemetry WHERE device_id = :d"), {"d": device})).scalars()
            seen_rows[reader] = {by_id[row_id] for row_id in ids}
            buckets = (await session.execute(text(
                "SELECT bucket FROM telemetry_hourly WHERE device_id = :d"), {"d": device})).scalars()
            seen_buckets[reader] = {bucket.astimezone(timezone.utc) for bucket in buckets}
            await session.rollback()
    assert seen_rows == EXPECTED_ROWS
    assert seen_buckets == EXPECTED_BUCKETS


async def test_superuser_bypasses_the_views_like_it_bypassed_rls(world):
    async with world["admin"].connect() as connection:
        count = (await connection.execute(text("SELECT count(*) FROM telemetry WHERE device_id = :d"),
                                          {"d": world["history"].device_id})).scalar_one()
    assert count == 3


async def _sqlstate(session, sql, params) -> str | None:
    try:
        await session.execute(text(sql), params)
    except DBAPIError as error:
        await session.rollback()
        return getattr(error.orig, "sqlstate", None)
    await session.rollback()
    return None


async def test_only_ingestion_identities_insert_and_nobody_updates_or_deletes(world, rls_engine_factory):
    history = world["history"]
    insert = ('INSERT INTO telemetry (id, device_id, device_serial, "values") '
              "VALUES (:id, :device, :serial, '{}'::jsonb)")
    params = {"id": uuid.uuid4(), "device": history.device_id, "serial": history.device_serial}
    role = rls_engine_factory()
    async with AsyncSession(role) as session:
        for identity in (world["readers"]["new_owner"], world["readers"]["admin"], "", None):
            await _as(session, identity)
            assert await _sqlstate(session, insert, params) == "42501", identity
        for identity in ("system_mqtt", "system_admin", world["readers"]["new_owner"]):
            await _as(session, identity)
            assert await _sqlstate(session, "UPDATE telemetry SET \"values\" = '{}' WHERE device_id = :device",
                                   params) == "42501", identity
            await _as(session, identity)
            assert await _sqlstate(session, "DELETE FROM telemetry WHERE device_id = :device", params) == "42501"
        # The private table itself is out of reach, even for the ingestion identity.
        await _as(session, "system_mqtt")
        assert await _sqlstate(session, insert.replace("INTO telemetry", "INTO telemetry_store.telemetry"),
                               params) == "42501"

        # The ingestion identity inserts through the view (raw SQL and the ORM); the environment
        # snapshot trigger still fills environment_id.
        await _as(session, "system_mqtt")
        await session.execute(text(insert), params)
        orm_row = Telemetry(device_id=history.device_id, device_serial=history.device_serial,
                            values={"dht22": {"temperature": 30}})
        orm_id = orm_row.id
        session.add(orm_row)
        await session.commit()
        await _as(session, "system_mqtt")
        environments = (await session.execute(text("SELECT environment_id FROM telemetry WHERE id IN (:a, :b)"),
                                              {"a": params["id"], "b": orm_id})).scalars().all()
        await session.rollback()
    assert environments == [history.new_environment_id, history.new_environment_id]


async def _store_relations(connection) -> list[str]:
    """The store schema, the hypertable, its chunks and compressed chunks, the aggregate's internals."""
    return list((await connection.execute(text("""
        WITH roots AS (
            SELECT h.id FROM _timescaledb_catalog.hypertable h
            WHERE h.schema_name = 'telemetry_store' AND h.table_name = 'telemetry'
            UNION SELECT ca.mat_hypertable_id FROM _timescaledb_catalog.continuous_agg ca
            WHERE ca.user_view_schema = 'telemetry_store'
        ), hypertables AS (
            SELECT id FROM roots
            UNION SELECT h.compressed_hypertable_id FROM _timescaledb_catalog.hypertable h
            WHERE h.id IN (SELECT id FROM roots) AND h.compressed_hypertable_id IS NOT NULL
        )
        SELECT format('%I.%I', h.schema_name, h.table_name) FROM _timescaledb_catalog.hypertable h
        WHERE h.id IN (SELECT id FROM hypertables)
        UNION SELECT c.relid::text FROM _timescaledb_catalog.chunk c
        WHERE c.hypertable_id IN (SELECT id FROM hypertables)
        UNION SELECT c.oid::regclass::text FROM pg_class c
        WHERE c.relnamespace = 'telemetry_store'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
    """))).scalars())


async def test_compressed_storage_is_private_and_still_filtered(world, rls_engine_factory, postgres_rls_config):
    admin, history = world["admin"], world["history"]
    async with admin.connect() as connection:
        await connection.execute(text("SELECT compress_chunk(c, if_not_compressed => true) "
                                      "FROM show_chunks('telemetry_store.telemetry', older_than => '2025-12-20'::timestamptz, "
                                      "newer_than => '2025-11-01'::timestamptz) c"))
        await connection.execute(text("SELECT compress_chunk(c, if_not_compressed => true) "
                                      "FROM show_chunks('telemetry_store.telemetry_hourly', older_than => '2026-01-15'::timestamptz) c"))
        await connection.commit()
        compressed = (await connection.execute(text("""
            SELECT count(*) FROM timescaledb_information.chunks
            WHERE hypertable_schema = 'telemetry_store' AND hypertable_name = 'telemetry' AND is_compressed
              AND range_start <= :t1 AND range_end > :t1"""), {"t1": T1})).scalar_one()
        assert compressed == 1
        relations = await _store_relations(connection)
        # TimescaleDB 2.30 keeps the columnstore inside the chunk relation itself (no separate
        # compressed hypertable); both the raw chunk and the aggregate's chunk are compressed here.
        assert (await connection.execute(text("""
            SELECT count(*) FROM timescaledb_information.chunks
            WHERE is_compressed AND (chunk_schema || '.' || chunk_name) = ANY(CAST(:relations AS text[]))
              AND hypertable_name LIKE '_materialized_hypertable_%'"""), {"relations": relations})).scalar_one() >= 1
        assert any(name.startswith("_timescaledb_internal._materialized_hypertable_") for name in relations)
        leaks = (await connection.execute(text(f"""
            SELECT r.rolname || ' -> ' || rel FROM unnest(CAST(:relations AS text[])) rel
            CROSS JOIN (VALUES ('ai_readonly'), ('ceiot_rls_test'), ('public')) r(rolname)
            WHERE has_table_privilege(r.rolname, rel, '{ALL_PRIVILEGES}')
               OR has_any_column_privilege(r.rolname, rel, 'SELECT,INSERT,UPDATE,REFERENCES')"""),
            {"relations": relations})).scalars().all()
        assert leaks == []
        schema = (await connection.execute(text(
            "SELECT bool_or(has_schema_privilege(r, 'telemetry_store', 'USAGE,CREATE')) "
            "FROM unnest(ARRAY['ai_readonly', 'ceiot_rls_test', 'public']) r"))).scalar_one()
        assert schema is False
        routines = (await connection.execute(text(
            "SELECT bool_or(has_function_privilege(r, p.oid, 'EXECUTE')) FROM pg_proc p "
            "CROSS JOIN unnest(ARRAY['ai_readonly', 'ceiot_rls_test', 'public']) r "
            "WHERE p.pronamespace = 'telemetry_store'::regnamespace"))).scalar_one()
        assert routines is False
        # Only the curated column grant on the view for the assistant; the hourly view is not exposed.
        assert (await connection.execute(text(
            "SELECT has_column_privilege('ai_readonly', 'public.telemetry', 'values', 'SELECT') "
            "AND NOT has_column_privilege('ai_readonly', 'public.telemetry', 'id', 'SELECT') "
            "AND NOT has_table_privilege('ai_readonly', 'public.telemetry', 'INSERT') "
            "AND NOT has_table_privilege('ai_readonly', 'public.telemetry_hourly', 'SELECT')"))).scalar_one()

    role = rls_engine_factory()
    async with AsyncSession(role) as session:
        for target in ("telemetry_store.telemetry", "telemetry_store.telemetry_hourly",
                       *[name for name in relations if name.startswith("_timescaledb_internal.")][:3]):
            await _as(session, "system_admin")
            assert await _sqlstate(session, f"SELECT 1 FROM {target} LIMIT 1", {}) == "42501", target
        # Compressed rows are still filtered by the view, and a late insert lands in the compressed chunk.
        await _as(session, world["readers"]["old_owner"])
        assert (await session.execute(text("SELECT count(*) FROM telemetry WHERE device_id = :d"),
                                      {"d": history.device_id})).scalar_one() == 2
        await session.rollback()
        await _as(session, world["readers"]["other"])
        assert (await session.execute(text("SELECT count(*) FROM telemetry WHERE device_id = :d"),
                                      {"d": history.device_id})).scalar_one() == 0
        await session.rollback()
        late = uuid.uuid4()
        await _as(session, "system_mqtt")
        await session.execute(text('INSERT INTO telemetry (time, id, device_id, device_serial, "values") '
                                   "VALUES (:t, :id, :d, :s, '{}'::jsonb)"),
                              {"t": T1 + timedelta(minutes=1), "id": late, "d": history.device_id,
                               "s": history.device_serial})
        await session.commit()
        await _as(session, world["readers"]["new_owner"])
        assert (await session.execute(text("SELECT count(*) FROM telemetry WHERE id = :id"),
                                      {"id": late})).scalar_one() == 1
        await session.rollback()


async def test_assistant_role_reads_telemetry_only_through_the_views(world, postgres_rls_config):
    from app.api.assistant.sql_executor import QueryFailed, run_trusted_query

    engine = create_async_engine(postgres_rls_config.admin_url)
    try:
        serial = world["history"].device_serial
        mine = await run_trusted_query(engine, world["readers"]["old_owner"],
            f"SELECT count(*) AS n FROM ai_read.telemetry WHERE device_serial = '{serial}'")
        assert mine.rows == [{"n": 2}]
        guest = await run_trusted_query(engine, world["readers"]["env_guest"],
            f"SELECT count(*) AS n FROM ai_read.telemetry WHERE device_serial = '{serial}'")
        assert guest.rows == [{"n": 1}]
        for sql in ("SELECT count(*) FROM telemetry_store.telemetry",
                    "SELECT count(*) FROM telemetry_store.telemetry_hourly",
                    "SELECT count(*) FROM public.telemetry_hourly"):
            with pytest.raises(QueryFailed) as failure:
                await run_trusted_query(engine, world["readers"]["old_owner"], sql)
            assert failure.value.code == "permission", sql
    finally:
        await engine.dispose()
