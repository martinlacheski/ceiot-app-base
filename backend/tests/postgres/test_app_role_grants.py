"""Migration 0029: the application login is unprivileged and RLS filters it.

``ceiot_rls_test`` is migrated as ``DB_APP_ROLE`` (see conftest), so the privileges checked here
are exactly the ones production grants ``iot_app``. The round trip runs in a throwaway
``<dev_db>_approle`` database with throwaway roles; it never touches the dev database, the shared
test database or the cluster's real application login.
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, SQLAlchemyError

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]
RLS_TEST_ROLE = "ceiot_rls_test"  # the application role stand-in (conftest)
RAG_SEARCH = "public.rag_search(public.vector, text, text, double precision, integer, uuid)"


def _scalar(url, sql, params=None):
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params or {}).scalar()
    finally:
        engine.dispose()


def _execute(url, sql):
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql(sql)
    finally:
        engine.dispose()


def test_app_role_is_unprivileged_and_may_only_switch_to_ai_readonly(postgres_rls_config):
    attributes = _scalar(postgres_rls_config.admin_url, """
        SELECT row(rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication)::text
        FROM pg_roles WHERE rolname = :r""", {"r": RLS_TEST_ROLE})
    assert attributes == "(f,f,f,f,f)"
    membership = _scalar(postgres_rls_config.admin_url, """
        SELECT row(m.inherit_option, m.set_option)::text FROM pg_auth_members m
        WHERE m.roleid = 'ai_readonly'::regrole AND m.member = CAST(:r AS regrole)""", {"r": RLS_TEST_ROLE})
    # SET ROLE ai_readonly for the assistant, without inheriting its column grants.
    assert membership == "(f,t)"


def test_app_role_privileges_are_exactly_what_the_application_uses(postgres_rls_config):
    checks = {
        "dml on device": "has_table_privilege(:r, 'public.device', 'SELECT,INSERT,UPDATE,DELETE')",
        "dml on user": "has_table_privilege(:r, 'public.\"user\"', 'SELECT,INSERT,UPDATE,DELETE')",
        "dml on sensorreading": "has_table_privilege(:r, 'public.sensorreading', 'SELECT,INSERT,UPDATE,DELETE')",
        "telemetry select/insert": "has_table_privilege(:r, 'public.telemetry', 'SELECT,INSERT')",
        "telemetry_hourly select": "has_table_privilege(:r, 'public.telemetry_hourly', 'SELECT')",
        "rag_search": f"has_function_privilege(:r, '{RAG_SEARCH}', 'EXECUTE')",
        "public usage": "has_schema_privilege(:r, 'public', 'USAGE')",
        "connect": "has_database_privilege(:r, current_database(), 'CONNECT')",
    }
    denied = {
        "alembic_version": "has_table_privilege(:r, 'public.alembic_version', 'SELECT,INSERT,UPDATE,DELETE')",
        "telemetry update/delete": "has_table_privilege(:r, 'public.telemetry', 'UPDATE,DELETE,TRUNCATE')",
        "telemetry_hourly writes": "has_table_privilege(:r, 'public.telemetry_hourly', 'INSERT,UPDATE,DELETE')",
        "truncate": "has_table_privilege(:r, 'public.device', 'TRUNCATE,TRIGGER')",
        "create in public": "has_schema_privilege(:r, 'public', 'CREATE')",
        "telemetry_store": "has_schema_privilege(:r, 'telemetry_store', 'USAGE,CREATE')",
        "ai_read": "has_schema_privilege(:r, 'ai_read', 'USAGE')",
        "create database objects": "has_database_privilege(:r, current_database(), 'CREATE')",
    }
    for label, predicate in {**checks, **denied}.items():
        assert _scalar(postgres_rls_config.admin_url, f"SELECT {predicate}", {"r": RLS_TEST_ROLE}) is (
            label in checks), label


def test_no_grant_reaches_telemetry_storage_or_chunks_for_untrusted_roles(postgres_rls_config):
    # Every relation of telemetry_store and every chunk of any hypertable: the application role
    # has nothing on telemetry storage, ai_readonly (untrusted SQL) has nothing on any chunk.
    leaks = _scalar(postgres_rls_config.admin_url, """
        SELECT count(*) FROM (
            SELECT c.oid, :r AS rolname FROM pg_class c
            WHERE c.relnamespace = 'telemetry_store'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
            UNION ALL
            SELECT (format('%I.%I', ch.chunk_schema, ch.chunk_name))::regclass, :r
            FROM timescaledb_information.chunks ch WHERE ch.hypertable_schema = 'telemetry_store'
            UNION ALL
            SELECT (format('%I.%I', ch.chunk_schema, ch.chunk_name))::regclass, 'ai_readonly'
            FROM timescaledb_information.chunks ch
        ) t WHERE has_table_privilege(t.rolname, t.oid, 'SELECT,INSERT,UPDATE,DELETE')""",
        {"r": RLS_TEST_ROLE})
    assert leaks == 0


def test_role_reads_telemetry_only_through_the_views(postgres_rls_config):
    engine = create_engine(postgres_rls_config.role_url)
    try:
        with engine.connect() as connection:
            for relation in ("telemetry_store.telemetry", "telemetry_store.telemetry_hourly"):
                with pytest.raises(DBAPIError, match="permission denied"):
                    connection.execute(text(f"SELECT 1 FROM {relation} LIMIT 1"))
                connection.rollback()
            with pytest.raises(DBAPIError, match="permission denied"):
                connection.execute(text("UPDATE telemetry SET device_serial = device_serial"))
            connection.rollback()
            assert connection.execute(text("SELECT count(*) >= 0 FROM telemetry_hourly")).scalar() is True
    finally:
        engine.dispose()


def test_tables_created_by_later_migrations_are_granted_by_default(postgres_rls_config):
    table = f"zz_default_privileges_{uuid.uuid4().hex[:8]}"
    admin = create_engine(postgres_rls_config.admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f"CREATE TABLE public.{table} (id serial PRIMARY KEY)")
            granted = connection.execute(text(
                "SELECT has_table_privilege(:r, :t, 'SELECT,INSERT,UPDATE,DELETE') "
                "AND has_sequence_privilege(:r, pg_get_serial_sequence(:t, 'id'), 'USAGE')"),
                {"r": RLS_TEST_ROLE, "t": f"public.{table}"}).scalar()
            assert granted is True
    finally:
        with admin.connect() as connection:
            connection.exec_driver_sql(f"DROP TABLE IF EXISTS public.{table}")
        admin.dispose()


def test_rls_filters_the_application_role_by_identity(postgres_rls_config):
    suffix = uuid.uuid4().hex[:8]
    ids = {name: uuid.uuid4() for name in ("owner", "other", "country", "state", "city", "type", "env", "member")}
    admin = create_engine(postgres_rls_config.admin_url)
    role = create_engine(postgres_rls_config.role_url)
    try:
        with admin.begin() as connection:
            for name in ("owner", "other"):
                connection.execute(text(
                    'INSERT INTO "user" (id, email, username, password, first_name, last_name, is_admin, is_active, '
                    "is_verified, is_social_auth, must_change_password, created_at) "
                    "VALUES (:i, :e, :u, 'x', 'A', 'B', false, true, true, false, false, now())"),
                    {"i": ids[name], "e": f"{name}-{suffix}@example.com", "u": f"{name}{suffix}"})
            connection.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, :n, true)"),
                               {"i": ids["country"], "n": f"Country {suffix}"})
            connection.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, 'S', :c, true)"),
                               {"i": ids["state"], "c": ids["country"]})
            connection.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) "
                                    "VALUES (:i, 'C', '1000', :s, true)"), {"i": ids["city"], "s": ids["state"]})
            connection.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:i, :n, true)"),
                               {"i": ids["type"], "n": f"Type {suffix}"})
            connection.execute(text(
                "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, "
                "is_public_map_visible) VALUES (:i, :n, 'a', '', 'd', :c, :t, true, false)"),
                {"i": ids["env"], "n": f"Env {suffix}", "c": ids["city"], "t": ids["type"]})
            connection.execute(text(
                "INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) "
                "VALUES (:i, :e, :u, true, true)"), {"i": ids["member"], "e": ids["env"], "u": ids["owner"]})

        visible = text("SELECT count(*) FROM environment WHERE id = :e")
        for identity, expected in ((ids["owner"], 1), (ids["other"], 0), ("", 0), ("system_admin", 1)):
            with role.begin() as connection:
                connection.execute(text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(identity)})
                assert connection.execute(visible, {"e": ids["env"]}).scalar() == expected, identity
        # The user table carries no RLS (authentication reads it without an identity).
        with role.begin() as connection:
            assert connection.execute(text('SELECT count(*) FROM "user" WHERE id = :u'),
                                      {"u": ids["other"]}).scalar() == 1
    finally:
        with admin.begin() as connection:
            connection.execute(text("DELETE FROM environmentuser WHERE id = :i"), {"i": ids["member"]})
            connection.execute(text("DELETE FROM environment WHERE id = :i"), {"i": ids["env"]})
            connection.execute(text("DELETE FROM environmenttype WHERE id = :i"), {"i": ids["type"]})
            connection.execute(text("DELETE FROM locationcity WHERE id = :i"), {"i": ids["city"]})
            connection.execute(text("DELETE FROM locationstate WHERE id = :i"), {"i": ids["state"]})
            connection.execute(text("DELETE FROM locationcountry WHERE id = :i"), {"i": ids["country"]})
            connection.execute(text('DELETE FROM "user" WHERE id IN (:a, :b)'), {"a": ids["owner"], "b": ids["other"]})
        admin.dispose()
        role.dispose()


# ---------------------------------------------------------------------------
# Round trip in a throwaway database


@pytest.fixture
def scratch_url():
    admin_url = make_url(settings.ALEMBIC_DATABASE_URL)
    if admin_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    admin_sync = admin_url.set(drivername="postgresql+psycopg")
    name = f"{admin_url.database}_approle"
    maintenance = create_engine(admin_sync, isolation_level="AUTOCOMMIT")
    terminate = ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                 "WHERE datname = %(n)s AND pid <> pg_backend_pid()")
    try:
        with maintenance.connect() as connection:
            connection.exec_driver_sql(terminate, {"n": name})
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    except SQLAlchemyError as exc:
        pytest.skip(f"cannot create the scratch database: {type(exc).__name__}")
    yield admin_sync.set(database=name)
    with maintenance.connect() as connection:
        connection.exec_driver_sql(terminate, {"n": name})
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _alembic(url, role, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False), DB_APP_ROLE=role)
    return subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)


def _privileges(url, role):
    return _scalar(url.render_as_string(hide_password=False), """
        SELECT row(
            has_table_privilege(:r, 'public.device', 'SELECT,INSERT,UPDATE,DELETE'),
            has_function_privilege(:r, 'public.rag_search(public.vector, text, text, double precision, integer, uuid)',
                                   'EXECUTE'),
            EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE a.grantee = CAST(:r AS regrole)))::text""", {"r": role})


def test_migration_round_trip_and_refusals(scratch_url):
    role = f"ceiot_approle_{uuid.uuid4().hex[:8]}"
    bypass = f"ceiot_approle_bypass_{uuid.uuid4().hex[:8]}"
    url = scratch_url.render_as_string(hide_password=False)
    try:
        # A missing role is created NOLOGIN so the grants have a target.
        result = _alembic(scratch_url, role, "upgrade", "head")
        assert result.returncode == 0, result.stderr[-3000:]
        assert _scalar(url, "SELECT row(rolcanlogin, rolsuper, rolbypassrls)::text FROM pg_roles WHERE rolname = :r",
                       {"r": role}) == "(f,f,f)"
        assert _privileges(scratch_url, role) == "(t,t,t)"

        result = _alembic(scratch_url, role, "downgrade", "0028")
        assert result.returncode == 0, result.stderr[-3000:]
        assert _privileges(scratch_url, role) == "(f,f,f)"
        # Cluster-wide membership is kept (other databases may use it).
        assert _scalar(url, "SELECT pg_has_role(:r, 'ai_readonly', 'MEMBER')", {"r": role}) is True

        # The application role may never be the migration role nor bypass RLS.
        migration_role = _scalar(url, "SELECT current_user")
        result = _alembic(scratch_url, migration_role, "upgrade", "head")
        assert result.returncode != 0 and "is the migration role" in result.stderr
        _execute(url, f"CREATE ROLE {bypass} NOLOGIN BYPASSRLS")
        result = _alembic(scratch_url, bypass, "upgrade", "head")
        assert result.returncode != 0 and "SUPERUSER or BYPASSRLS" in result.stderr
        assert _scalar(url, "SELECT version_num FROM alembic_version") == "0028"

        result = _alembic(scratch_url, role, "upgrade", "head")
        assert result.returncode == 0, result.stderr[-3000:]
        assert _privileges(scratch_url, role) == "(t,t,t)"
    finally:
        # Only the scratch database holds privileges of these roles: DROP OWNED there, then DROP ROLE.
        for name in (role, bypass):
            _execute(url, f"""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{name}') THEN
                        EXECUTE 'DROP OWNED BY {name}';
                        EXECUTE 'DROP ROLE {name}';
                    END IF;
                END $$""")

