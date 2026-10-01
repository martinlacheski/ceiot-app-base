"""ai_read schema, ai_readonly role and curated text-to-SQL views

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-01

Database layer of the assistant's text-to-SQL (the SQL guard in
``app/api/assistant/sql_guard.py`` is the other layer). Generated SQL runs as
the NOLOGIN role ``ai_readonly`` (``SET LOCAL ROLE``) inside the asking user's
RLS identity (``app.current_user_id``), over the views below.

Why the views are ``WITH (security_invoker = true)``: a default view runs with
its owner's rights, which would bypass the base tables' Row Level Security
(the reference practice's views did exactly that). With ``security_invoker``
the base tables' RLS is evaluated for the *invoker*, i.e. ``ai_readonly`` under
the asking user's identity, so tenants and guests only see what the API already
shows them. ``SET LOCAL ROLE`` also drops the application login's BYPASSRLS
(the dev role is a superuser): RLS only bites for the role actually in effect.

Privileges: ``ai_readonly`` gets SELECT on the *exact base columns* the views
read, nothing else (never ``document``, ``assistant_query_log`` or any auth
column). Policy expressions run with the invoker's privileges, so the minimum
columns that the existing policies read (``"user"``: id/is_admin/is_active,
membership and guest-relation key columns) must be granted too; those carry no
personal data. The table-level privileges are only a second wall: the SQL guard
allows nothing but ``ai_read`` views, and RLS still isolates tenants if the
guard were ever bypassed.

Guest window: the API shows guests telemetry only from their access start
(``access_starts_at``); base RLS alone does not enforce that, so
``ai_read.telemetry_visible`` (SECURITY DEFINER, fixed search_path) applies it
inside the telemetry view. Everything is qualified with ``public.`` because the
executor runs with ``search_path = pg_catalog``.

The role is cluster-wide (roles are not per-database): creation and the
membership grant to the migrating (application) role are idempotent so a second
database on the same server (the test database) can migrate too. Non-superuser
deployments need CREATEROLE for the migrating role. PostgreSQL only; other
dialects (the SQLite unit tests) skip it.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UID = "pg_catalog.current_setting('app.current_user_id', true)"

# Base columns the views and the existing RLS policies read; nothing else is granted.
BASE_COLUMN_GRANTS = {
    "telemetry": ("time", "device_id", "device_serial", "environment_id", '"values"'),
    "device": ("id", "serial", "name", "device_type_id", "environment_id", "status", "enabled",
               "is_active", "broker_connected", "last_connection"),
    "device_type": ("id", "name"),
    "environment": ("id", "name", "city_id", "type_id", "is_active"),
    "environmenttype": ("id", "name"),
    "locationcity": ("id", "name", "state_id"),
    "locationstate": ("id", "name", "country_id"),
    "locationcountry": ("id", "name"),
    "device_sensor": ("device_id", "sensor_id", "key", "is_active", "installed_at"),
    "sensor": ("id", "code", "name", "manufacturer"),
    "variable": ("id", "code", "name", "unit", "is_active"),
    # Read by the existing RLS policies (membership, guest windows, admin check).
    "environmentuser": ("environment_id", "user_id", "is_owner", "is_active"),
    "scoped_guest_relation": ("scope_type", "scope_id", "guest_user_id", "owner_user_id", "is_active",
                              "access_starts_at"),
    '"user"': ("id", "is_admin", "is_active"),
}

VIEWS = ("telemetry", "devices", "environments", "sensors", "variables")


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("""
        DO $role$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ai_readonly') THEN
                CREATE ROLE ai_readonly NOLOGIN;
            END IF;
        END
        $role$
    """)
    op.execute(
        "ALTER ROLE ai_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT "
        "NOREPLICATION NOBYPASSRLS"
    )
    # The application role must be able to SET ROLE to it (a no-op for superusers).
    op.execute("GRANT ai_readonly TO CURRENT_USER")

    op.execute("CREATE SCHEMA IF NOT EXISTS ai_read")
    op.execute("REVOKE ALL ON SCHEMA ai_read FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA ai_read TO ai_readonly")
    op.execute("GRANT USAGE ON SCHEMA public TO ai_readonly")

    for table, columns in BASE_COLUMN_GRANTS.items():
        op.execute(f"GRANT SELECT ({', '.join(columns)}) ON public.{table} TO ai_readonly")

    system = f"{UID} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    admin = (
        'EXISTS (SELECT 1 FROM public."user" u '
        f"WHERE u.id::text = {UID} AND u.is_admin AND u.is_active)"
    )
    member = (
        "EXISTS (SELECT 1 FROM public.environmentuser eu "
        f"WHERE eu.environment_id = p_environment AND eu.user_id::text = {UID} AND {UID} <> '' "
        "AND eu.is_active = true)"
    )
    guest = (
        "EXISTS (SELECT 1 FROM public.scoped_guest_relation sgr "
        f"WHERE sgr.guest_user_id::text = {UID} AND {UID} <> '' AND sgr.is_active = true "
        "AND sgr.access_starts_at <= (p_time AT TIME ZONE 'UTC') "
        "AND ((sgr.scope_type = 'environment' AND sgr.scope_id = p_environment) "
        "OR (sgr.scope_type = 'device' AND sgr.scope_id = p_device)))"
    )
    op.execute(f"""
        CREATE FUNCTION ai_read.telemetry_visible(p_device uuid, p_environment uuid, p_time timestamptz)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp AS $fn$
            SELECT COALESCE({system}, false) OR {admin} OR {member} OR {guest}
        $fn$
    """)
    op.execute("REVOKE ALL ON FUNCTION ai_read.telemetry_visible(uuid, uuid, timestamptz) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION ai_read.telemetry_visible(uuid, uuid, timestamptz) TO ai_readonly")

    op.execute("""
        CREATE VIEW ai_read.telemetry WITH (security_invoker = true) AS
        SELECT t.time AS measured_at,
               t.device_id,
               t.device_serial,
               d.name AS device_name,
               t.environment_id,
               e.name AS environment_name,
               s.key AS sensor_key,
               sn.code AS sensor_model_code,
               sn.name AS sensor_model,
               v.key AS variable,
               var.name AS variable_name,
               var.unit AS unit,
               (v.value #>> '{}')::numeric AS value
        FROM public.telemetry t
        CROSS JOIN LATERAL pg_catalog.jsonb_each(t."values") AS s(key, value)
        CROSS JOIN LATERAL pg_catalog.jsonb_each(
            CASE WHEN pg_catalog.jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{}'::jsonb END
        ) AS v(key, value)
        LEFT JOIN public.device d ON d.id = t.device_id
        LEFT JOIN public.environment e ON e.id = t.environment_id
        LEFT JOIN public.device_sensor ds ON ds.device_id = t.device_id AND ds.key = s.key
        LEFT JOIN public.sensor sn ON sn.id = ds.sensor_id
        LEFT JOIN public.variable var ON var.code = v.key
        WHERE pg_catalog.jsonb_typeof(v.value) = 'number'
          AND ai_read.telemetry_visible(t.device_id, t.environment_id, t.time)
    """)
    op.execute("""
        CREATE VIEW ai_read.devices WITH (security_invoker = true) AS
        SELECT d.id, d.serial, d.name,
               dt.name AS device_type,
               d.environment_id,
               e.name AS environment_name,
               d.status::text AS status,
               d.enabled,
               d.is_active,
               d.broker_connected AS online,
               d.last_connection
        FROM public.device d
        LEFT JOIN public.device_type dt ON dt.id = d.device_type_id
        LEFT JOIN public.environment e ON e.id = d.environment_id
    """)
    op.execute("""
        CREATE VIEW ai_read.environments WITH (security_invoker = true) AS
        SELECT e.id, e.name,
               et.name AS environment_type,
               c.name AS city,
               st.name AS state,
               co.name AS country,
               e.is_active
        FROM public.environment e
        LEFT JOIN public.environmenttype et ON et.id = e.type_id
        LEFT JOIN public.locationcity c ON c.id = e.city_id
        LEFT JOIN public.locationstate st ON st.id = c.state_id
        LEFT JOIN public.locationcountry co ON co.id = st.country_id
    """)
    op.execute("""
        CREATE VIEW ai_read.sensors WITH (security_invoker = true) AS
        SELECT ds.device_id,
               d.serial AS device_serial,
               d.name AS device_name,
               ds.key AS sensor_key,
               sn.code AS sensor_model_code,
               sn.name AS sensor_model,
               sn.manufacturer,
               ds.is_active,
               ds.installed_at
        FROM public.device_sensor ds
        JOIN public.device d ON d.id = ds.device_id
        LEFT JOIN public.sensor sn ON sn.id = ds.sensor_id
    """)
    op.execute("""
        CREATE VIEW ai_read.variables WITH (security_invoker = true) AS
        SELECT var.code, var.name, var.unit
        FROM public.variable var
        WHERE var.is_active
    """)
    for view in VIEWS:
        op.execute(f"REVOKE ALL ON ai_read.{view} FROM PUBLIC")
        op.execute(f"GRANT SELECT ON ai_read.{view} TO ai_readonly")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for view in VIEWS:
        op.execute(f"DROP VIEW IF EXISTS ai_read.{view}")
    op.execute("DROP FUNCTION IF EXISTS ai_read.telemetry_visible(uuid, uuid, timestamptz)")
    op.execute("DROP SCHEMA IF EXISTS ai_read")
    # Removes this database's grants to the role. The role itself is cluster-wide:
    # it is dropped only when no other database still depends on it.
    op.execute("DROP OWNED BY ai_readonly")
    op.execute("""
        DO $drop$
        BEGIN
            DROP ROLE ai_readonly;
        EXCEPTION
            WHEN dependent_objects_still_exist OR insufficient_privilege OR undefined_object THEN
                RAISE NOTICE 'ai_readonly kept: still referenced by another database';
        END
        $drop$
    """)
