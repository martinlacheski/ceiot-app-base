"""every naive timestamp column becomes timestamptz

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-11

Normalization item 8: the older tables mixed ``timestamp`` (naive) with the ``timestamptz``
of the hypertables and newer tables. Every writer stored UTC wall clocks in the naive
columns (``utc_now()``/``utcnow()``, and ``datetime.now()`` in containers running on UTC),
so the conversion reads them as UTC: ``USING col AT TIME ZONE 'UTC'`` keeps every instant.
Downgrade does the inverse (``timestamptz AT TIME ZONE 'UTC'`` is the UTC wall clock).

Dependent objects:

* ``ai_read.devices`` selects ``device.last_connection``; a view column cannot change type,
  so the view is dropped and recreated with the 0012 definition, options and grant.
* Seven RLS policies (device, environment, deviceoperation, device_sensor and the device
  data tables) read ``scoped_guest_relation.access_starts_at``; PostgreSQL refuses to change
  the type of a column a policy uses. Their expressions are read from ``pg_policies``,
  neutralized for the duration of the ALTER and restored verbatim, all in the migration's
  transaction (no window without them). Roles, command and permissiveness never change.
* ``ai_read.telemetry_visible`` compared the naive column with ``p_time AT TIME ZONE 'UTC'``;
  with ``timestamptz`` that would cast back through the caller's session time zone, so it
  now compares the two instants directly (same signature, owner, grants and settings).

Column privileges (``ai_readonly`` column grants) and server defaults survive the type change.
The tables are small catalogs; the ALTER rewrites them.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0022"
down_revision: Union[str, Sequence[str], None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = {
    "device": ("broker_connected_at", "broker_disconnected_at", "broker_status_updated_at",
               "gps_updated_at", "last_connection", "updated_at"),
    "device_location_report": ("created_at", "reported_at"),
    "device_type": ("created_at", "updated_at"),
    "environment": ("updated_at",),
    "environmentinvitation": ("created_at", "processed_at", "updated_at"),
    "environmenttype": ("updated_at",),
    "environmentuser": ("updated_at",),
    "firmware_release": ("created_at",),
    "firmware_update": ("created_at", "download_expires_at", "downloaded_at", "updated_at"),
    "identificationtype": ("updated_at",),
    "locationcity": ("updated_at",),
    "locationcountry": ("updated_at",),
    "locationstate": ("updated_at",),
    "scoped_guest_invitation": ("access_starts_at", "created_at", "processed_at", "updated_at"),
    "scoped_guest_relation": ("access_starts_at", "created_at", "updated_at"),
    "user": ("created_at", "last_login_at", "last_seen_at", "updated_at"),
}

UID = "pg_catalog.current_setting('app.current_user_id', true)"

DEVICES_VIEW = """
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
"""

# Policies that read one of the converted columns (found through pg_depend, so a policy added
# later is covered too).
DEPENDENT_POLICIES = """
SELECT DISTINCT pol.polname, cls.relname, pol.polcmd,
       pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS qual,
       pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
FROM pg_catalog.pg_depend dep
JOIN pg_catalog.pg_policy pol ON pol.oid = dep.objid AND dep.classid = 'pg_catalog.pg_policy'::regclass
JOIN pg_catalog.pg_class cls ON cls.oid = pol.polrelid
JOIN pg_catalog.pg_attribute att ON att.attrelid = dep.refobjid AND att.attnum = dep.refobjsubid
JOIN pg_catalog.pg_class ref ON ref.oid = dep.refobjid
JOIN pg_catalog.pg_namespace ns ON ns.oid = ref.relnamespace
WHERE ns.nspname = 'public' AND (ref.relname || '.' || att.attname) = ANY(:columns)
ORDER BY cls.relname, pol.polname
"""


def _telemetry_visible(guest_time_condition: str) -> str:
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
        f"AND {guest_time_condition} "
        "AND ((sgr.scope_type = 'environment' AND sgr.scope_id = p_environment) "
        "OR (sgr.scope_type = 'device' AND sgr.scope_id = p_device)))"
    )
    # CREATE OR REPLACE keeps the owner and the EXECUTE grants of 0012.
    return f"""
        CREATE OR REPLACE FUNCTION ai_read.telemetry_visible(p_device uuid, p_environment uuid, p_time timestamptz)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp AS $fn$
            SELECT COALESCE({system}, false) OR {admin} OR {member} OR {guest}
        $fn$
    """


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _convert(target: str, using: str) -> None:
    bind = op.get_bind()
    columns = [f"{table}.{column}" for table, names in COLUMNS.items() for column in names]
    policies = bind.execute(text(DEPENDENT_POLICIES), {"columns": columns}).all()

    op.execute("DROP VIEW ai_read.devices")
    # Neutralize, convert, restore: the original expressions are reapplied verbatim.
    for name, table, command, qual, with_check in policies:
        clauses = []
        if qual is not None:
            clauses.append("USING (true)")
        if with_check is not None:
            clauses.append("WITH CHECK (true)")
        op.execute(f"ALTER POLICY {_quote(name)} ON public.{_quote(table)} {' '.join(clauses)}")

    for table, names in COLUMNS.items():
        changes = ", ".join(
            f"ALTER COLUMN {_quote(column)} TYPE {target} USING {_quote(column)} {using}" for column in names
        )
        op.execute(f"ALTER TABLE public.{_quote(table)} {changes}")

    for name, table, command, qual, with_check in policies:
        clauses = []
        if qual is not None:
            clauses.append(f"USING ({qual})")
        if with_check is not None:
            clauses.append(f"WITH CHECK ({with_check})")
        op.execute(f"ALTER POLICY {_quote(name)} ON public.{_quote(table)} {' '.join(clauses)}")

    op.execute(DEVICES_VIEW)
    op.execute("GRANT SELECT ON ai_read.devices TO ai_readonly")


def upgrade() -> None:
    _convert("timestamptz", "AT TIME ZONE 'UTC'")
    op.execute(_telemetry_visible("sgr.access_starts_at <= p_time"))


def downgrade() -> None:
    _convert("timestamp", "AT TIME ZONE 'UTC'")
    op.execute(_telemetry_visible("sgr.access_starts_at <= (p_time AT TIME ZONE 'UTC')"))
