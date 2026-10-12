"""telemetry moves to a private store: compression, retention and an hourly continuous aggregate

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-12

Why: TimescaleDB 2.30 refuses columnstore compression ("columnstore cannot be used on table
with row security") and continuous aggregates ("cannot create continuous aggregate on
hypertable with row security") on a hypertable with RLS enabled or forced. Telemetry is the
big table, so it leaves RLS behind and keeps the same visibility through views:

* ``public.telemetry`` (hypertable) moves to the private schema ``telemetry_store`` (no
  privileges for anyone but the owner: PUBLIC, ``ai_readonly`` and every other grantee are
  revoked on the table and on every chunk). Its two policies are dropped and RLS disabled.
* ``telemetry_store.guard_telemetry_write`` (BEFORE INSERT/UPDATE/DELETE, fires before the
  environment snapshot trigger) replaces the INSERT policy: a role without BYPASSRLS may only
  INSERT under ``app.current_user_id`` ``system_mqtt``/``system_admin`` and may never
  UPDATE/DELETE (before, no UPDATE/DELETE policy existed: forced RLS hid every row). SQLSTATE
  42501 otherwise. Superusers and BYPASSRLS roles pass, exactly as they bypassed RLS.
* ``public.telemetry`` becomes a ``security_barrier`` view (owner rights) filtered by the old
  ``device_data_access`` predicate plus (a) the RLS bypass of superusers/BYPASSRLS roles, so
  the application login keeps its behaviour, and (b) the guest window per row
  (``access_starts_at <= time``), the semantics ``ai_read.telemetry_visible`` already applied.
  The view is auto-updatable: the ORM keeps inserting into ``telemetry`` and the guard decides.
* Compression (segmentby ``device_id``, orderby ``time DESC, id``) after 7 days and raw
  retention of 1 year.
* ``telemetry_store.telemetry_hourly``: continuous aggregate per hour, device, environment
  snapshot, sensor key and variable (sum/min/max/readings; averages are sum/readings so any
  coarser bucket re-aggregates exactly), real time (``materialized_only = false``), refreshed
  every 30 min over [now - 3 days, now - 1 hour], compressed after 7 days, never dropped.
  ``public.telemetry_hourly`` exposes it with the same predicate (guest: ``access_starts_at <=
  bucket``).
* ``sensorreading`` keeps RLS and gets a 90-day retention policy. ``deviceoperation`` keeps RLS
  and its rows: a custom job deletes only routine rows (``SENSOR_DATA``, ``KEEP_ACTIVE``) older
  than 90 days; MOVE/UNPAIR (name snapshots used by the history), firmware, errors and the rest
  are kept.
* Jobs are staggered (FK locks of concurrent drop_chunks deadlocked in the spike), all after the
  default 03:00 (UTC-3) backup: telemetry retention 07:00 UTC, sensorreading 07:20,
  deviceoperation 07:40, telemetry compression 08:00, aggregate compression 08:20.
* ``ai_read.telemetry`` followed the moved table by OID: it is recreated over the view with the
  same definition, options and grants.

The initial materialization (``refresh_continuous_aggregate`` over the whole history) cannot run
inside a transaction block: it runs at the end of upgrade() in an autocommit block (which commits
everything before it), and the aggregate's refresh and compression policies are added only after it
(a policy run starting as soon as it is committed made the initial refresh fail as concurrent). A
NULL start is safe only here (nothing has been dropped yet); see docs/ciclo-de-vida-datos.md.

downgrade(): removes the jobs, the aggregate and its view, decompresses every chunk, disables
compression, moves the table back to ``public`` with its policies and forced RLS, and recreates
``ai_read.telemetry`` and the 0012 column grants. Aggregated history beyond the raw retention is
lost. PostgreSQL only.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0028"
down_revision: Union[str, Sequence[str], None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STORE = "telemetry_store"
CAGG = f"{STORE}.telemetry_hourly"
PRUNE_PROCEDURE = f"{STORE}.prune_routine_device_operations"
ROUTINE_OPERATIONS = ("SENSOR_DATA", "KEEP_ACTIVE")
AI_COLUMNS = ("time", "device_id", "device_serial", "environment_id", '"values"')

# Same fragments as 0005 (the policy texts restored by downgrade must deparse identically).
UID = "current_setting('app.current_user_id', true)"
SYSTEM = f"{UID} = ANY (ARRAY['system_mqtt', 'system_admin'])"
ADMIN = f"EXISTS (SELECT 1 FROM public.\"user\" u WHERE u.id::text = {UID} AND u.is_admin AND u.is_active)"
MEMBERS = (
    "SELECT eu.environment_id FROM public.environmentuser eu "
    f"WHERE eu.user_id::text = {UID} AND {UID} <> '' AND eu.is_active = true"
)
GUESTS = (
    "SELECT sgr.scope_id FROM public.scoped_guest_relation sgr "
    f"WHERE sgr.scope_type = 'environment' AND sgr.guest_user_id::text = {UID} "
    f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {UID} <> ''"
)
GUEST_DEVICES = (
    "SELECT sgr.scope_id FROM public.scoped_guest_relation sgr "
    f"WHERE sgr.scope_type = 'device' AND sgr.guest_user_id::text = {UID} "
    f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {UID} <> ''"
)
# RLS never applied to superusers and BYPASSRLS roles (the application login): neither do the views.
BYPASS = (
    "COALESCE((SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r "
    "WHERE r.rolname = CURRENT_USER), false)"
)


def visible(alias: str, time_column: str) -> str:
    """The old device_data_access predicate, plus the RLS bypass and the per-row guest window."""
    return (
        f"({BYPASS} OR {SYSTEM} OR {ADMIN} "
        f"OR {alias}.environment_id IN ({MEMBERS}) "
        f"OR {alias}.environment_id IN ({GUESTS} AND sgr.access_starts_at <= {alias}.{time_column}) "
        f"OR {alias}.device_id IN ({GUEST_DEVICES} AND sgr.access_starts_at <= {alias}.{time_column}))"
    )


AI_READ_TELEMETRY = """
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
"""

# Revokes every privilege of every role but the owner on a relation (table and column level).
REVOKE_NON_OWNER = """
DO $revoke$
DECLARE
    rel regclass;
    grantee oid;
BEGIN
    FOR rel IN
        SELECT '{table}'::regclass
        UNION ALL
        SELECT i.inhrelid::regclass FROM pg_catalog.pg_inherits i WHERE i.inhparent = '{table}'::regclass
    LOOP
        FOR grantee IN
            SELECT a.grantee FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.oid = rel AND a.grantee <> c.relowner
            UNION
            SELECT a.grantee FROM pg_catalog.pg_attribute att
            JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
            CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
            WHERE att.attrelid = rel AND att.attacl IS NOT NULL AND a.grantee <> c.relowner
        LOOP
            EXECUTE format('REVOKE ALL ON TABLE %s FROM %s', rel,
                CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_catalog.pg_get_userbyid(grantee)) END);
        END LOOP;
    END LOOP;
END
$revoke$
"""

GUARD_FUNCTION = f"""
CREATE FUNCTION {STORE}.guard_telemetry_write()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
    IF {BYPASS} THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'INSERT' AND COALESCE({SYSTEM}, false) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'telemetry: % is not allowed for this identity', TG_OP
        USING ERRCODE = '42501';
END
$guard$
"""

CAGG_DEFINITION = f"""
CREATE MATERIALIZED VIEW {CAGG}
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', t.time) AS bucket,
       t.device_id,
       t.environment_id,
       s.key AS sensor_key,
       v.key AS variable,
       sum((v.value #>> '{{}}')::numeric) AS sum_value,
       min((v.value #>> '{{}}')::numeric) AS min_value,
       max((v.value #>> '{{}}')::numeric) AS max_value,
       count(*) AS readings
FROM {STORE}.telemetry t
CROSS JOIN LATERAL jsonb_each(t."values") AS s(key, value)
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{{}}'::jsonb END)
    AS v(key, value)
WHERE jsonb_typeof(v.value) = 'number'
GROUP BY 1, 2, 3, 4, 5
WITH NO DATA
"""

PRUNE_DEFINITION = f"""
CREATE PROCEDURE {PRUNE_PROCEDURE}(job_id integer, config jsonb)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $prune$
DECLARE
    keep interval := COALESCE((config ->> 'drop_after')::interval, INTERVAL '90 days');
BEGIN
    PERFORM set_config('app.current_user_id', 'system_admin', true);
    DELETE FROM public.deviceoperation
    WHERE operation_type::text = ANY (ARRAY[{", ".join(f"'{name}'" for name in ROUTINE_OPERATIONS)}])
      AND time < now() - keep;
END
$prune$
"""


def _at_utc(hhmm: str) -> str:
    """Next occurrence of a UTC time of day (jobs keep a fixed daily schedule from there)."""
    return f"(date_trunc('day', now() AT TIME ZONE 'UTC') + INTERVAL '1 day {hhmm}') AT TIME ZONE 'UTC'"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(f"CREATE SCHEMA {STORE}")
    op.execute(f"REVOKE ALL ON SCHEMA {STORE} FROM PUBLIC")
    op.execute(f"COMMENT ON SCHEMA {STORE} IS 'Private telemetry storage (no RLS): read it through public.telemetry and public.telemetry_hourly'")

    op.execute("DROP VIEW ai_read.telemetry")
    op.execute(f"ALTER TABLE public.telemetry SET SCHEMA {STORE}")
    op.execute(f"DROP POLICY device_data_access ON {STORE}.telemetry")
    op.execute(f"DROP POLICY device_data_system_write ON {STORE}.telemetry")
    op.execute(f"ALTER TABLE {STORE}.telemetry NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {STORE}.telemetry DISABLE ROW LEVEL SECURITY")
    op.execute(REVOKE_NON_OWNER.format(table=f"{STORE}.telemetry"))

    op.execute(GUARD_FUNCTION)
    op.execute(f"REVOKE ALL ON FUNCTION {STORE}.guard_telemetry_write() FROM PUBLIC")
    # BEFORE triggers fire in name order: the guard runs before set_telemetry_environment_id.
    op.execute(
        f"CREATE TRIGGER guard_telemetry_write BEFORE INSERT OR UPDATE OR DELETE ON {STORE}.telemetry "
        f"FOR EACH ROW EXECUTE FUNCTION {STORE}.guard_telemetry_write()"
    )

    op.execute(f"""
        CREATE VIEW public.telemetry WITH (security_barrier = true) AS
        SELECT t.time, t.id, t.device_id, t.device_serial, t.environment_id, t."values"
        FROM {STORE}.telemetry t
        WHERE {visible('t', 'time')}
    """)
    op.execute("ALTER VIEW public.telemetry ALTER COLUMN time SET DEFAULT now()")
    op.execute("REVOKE ALL ON public.telemetry FROM PUBLIC")
    op.execute(f"GRANT SELECT ({', '.join(AI_COLUMNS)}) ON public.telemetry TO ai_readonly")
    op.execute("COMMENT ON VIEW public.telemetry IS 'Telemetry visible to the current identity (former RLS predicate); writes go through telemetry_store.guard_telemetry_write'")

    op.execute(AI_READ_TELEMETRY)
    op.execute("REVOKE ALL ON ai_read.telemetry FROM PUBLIC")
    op.execute("GRANT SELECT ON ai_read.telemetry TO ai_readonly")

    op.execute(
        f"ALTER TABLE {STORE}.telemetry SET (timescaledb.compress, "
        "timescaledb.compress_segmentby = 'device_id', timescaledb.compress_orderby = 'time DESC, id')"
    )
    op.execute(f"SELECT add_retention_policy('{STORE}.telemetry', drop_after => INTERVAL '1 year', "
               f"schedule_interval => INTERVAL '1 day', initial_start => {_at_utc('07:00')}, timezone => 'UTC')")
    op.execute(f"SELECT add_compression_policy('{STORE}.telemetry', compress_after => INTERVAL '7 days', "
               f"schedule_interval => INTERVAL '1 day', initial_start => {_at_utc('08:00')}, timezone => 'UTC')")

    op.execute(CAGG_DEFINITION)
    op.execute(f"REVOKE ALL ON {CAGG} FROM PUBLIC")
    op.execute(f"""
        CREATE VIEW public.telemetry_hourly WITH (security_barrier = true) AS
        SELECT h.bucket, h.device_id, h.environment_id, h.sensor_key, h.variable,
               h.sum_value, h.min_value, h.max_value, h.readings
        FROM {CAGG} h
        WHERE {visible('h', 'bucket')}
    """)
    op.execute("REVOKE ALL ON public.telemetry_hourly FROM PUBLIC")
    op.execute("COMMENT ON VIEW public.telemetry_hourly IS 'Hourly telemetry rollup (sum/min/max/readings) visible to the current identity'")

    op.execute(f"SELECT add_retention_policy('public.sensorreading', drop_after => INTERVAL '90 days', "
               f"schedule_interval => INTERVAL '1 day', initial_start => {_at_utc('07:20')}, timezone => 'UTC')")
    op.execute(PRUNE_DEFINITION)
    op.execute(f"REVOKE ALL ON PROCEDURE {PRUNE_PROCEDURE}(integer, jsonb) FROM PUBLIC")
    op.execute(f"SELECT add_job('{PRUNE_PROCEDURE}', INTERVAL '1 day', "
               "config => '{\"drop_after\": \"90 days\"}'::jsonb, "
               f"initial_start => {_at_utc('07:40')}, timezone => 'UTC')")

    # Initial materialization of the whole history. It cannot run inside a transaction block, and
    # the refresh policy is added only afterwards: a policy run starting as soon as it is committed
    # would make this refresh fail as concurrent.
    with op.get_context().autocommit_block():
        op.execute(f"CALL refresh_continuous_aggregate('{CAGG}', NULL, now() - INTERVAL '1 hour')")
    op.execute(f"SELECT add_continuous_aggregate_policy('{CAGG}', start_offset => INTERVAL '3 days', "
               "end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '30 minutes')")
    op.execute(f"ALTER MATERIALIZED VIEW {CAGG} SET (timescaledb.compress = true, "
               "timescaledb.compress_segmentby = 'device_id', timescaledb.compress_orderby = 'bucket DESC')")
    op.execute(f"SELECT add_compression_policy('{CAGG}', compress_after => INTERVAL '7 days', "
               f"schedule_interval => INTERVAL '1 day', initial_start => {_at_utc('08:20')}, timezone => 'UTC')")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        "SELECT delete_job(j.job_id) FROM timescaledb_information.jobs j "
        f"WHERE j.proc_schema = '{STORE}' AND j.proc_name = 'prune_routine_device_operations'"
    )
    op.execute(f"DROP PROCEDURE {PRUNE_PROCEDURE}(integer, jsonb)")
    op.execute("SELECT remove_retention_policy('public.sensorreading', if_exists => true)")

    op.execute("DROP VIEW public.telemetry_hourly")
    op.execute(f"DROP MATERIALIZED VIEW {CAGG}")

    op.execute(f"SELECT remove_compression_policy('{STORE}.telemetry', if_exists => true)")
    op.execute(f"SELECT remove_retention_policy('{STORE}.telemetry', if_exists => true)")
    op.execute(f"SELECT decompress_chunk(c, if_compressed => true) FROM show_chunks('{STORE}.telemetry') c")
    op.execute(f"ALTER TABLE {STORE}.telemetry SET (timescaledb.compress = false)")

    op.execute("DROP VIEW ai_read.telemetry")
    op.execute("DROP VIEW public.telemetry")
    op.execute(f"DROP TRIGGER guard_telemetry_write ON {STORE}.telemetry")
    op.execute(f"DROP FUNCTION {STORE}.guard_telemetry_write()")

    op.execute(f"ALTER TABLE {STORE}.telemetry SET SCHEMA public")
    op.execute("ALTER TABLE public.telemetry ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.telemetry FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY device_data_access ON public.telemetry FOR SELECT TO PUBLIC USING "
        f"({SYSTEM} OR {ADMIN} OR environment_id IN ({MEMBERS}) OR environment_id IN ({GUESTS}) "
        f"OR device_id IN ({GUEST_DEVICES}))"
    )
    op.execute(f"CREATE POLICY device_data_system_write ON public.telemetry FOR INSERT TO PUBLIC WITH CHECK ({SYSTEM})")
    op.execute(f"GRANT SELECT ({', '.join(AI_COLUMNS)}) ON public.telemetry TO ai_readonly")

    op.execute(AI_READ_TELEMETRY)
    op.execute("REVOKE ALL ON ai_read.telemetry FROM PUBLIC")
    op.execute("GRANT SELECT ON ai_read.telemetry TO ai_readonly")
    op.execute(f"DROP SCHEMA {STORE}")
