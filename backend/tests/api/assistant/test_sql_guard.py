"""The SQL guard is the first security layer: only a tiny SELECT grammar over ai_read views passes."""

import pytest

from app.api.assistant.sql_guard import MAX_LIMIT, SQLRejected, ValidatedSQL, validate_sql

GOOD = [
    "SELECT AVG(value) AS promedio FROM ai_read.telemetry WHERE variable = 'temperature' "
    "AND measured_at >= now() - INTERVAL '24 hours' LIMIT 1",
    "SELECT device_name, MAX(value) AS maximo, MIN(value) AS minimo FROM ai_read.telemetry "
    "WHERE variable = 'relative_humidity' GROUP BY device_name ORDER BY maximo DESC LIMIT 20",
    "SELECT date_trunc('hour', measured_at) AS hora, ROUND(AVG(value), 2) AS promedio "
    "FROM ai_read.telemetry WHERE device_serial = 'ESP-1' AND measured_at >= now() - INTERVAL '2 days' "
    "GROUP BY 1 ORDER BY 1 LIMIT 48",
    "SELECT COUNT(*) AS n FROM ai_read.telemetry LIMIT 1",
    "SELECT COUNT(DISTINCT device_id) AS equipos FROM ai_read.telemetry LIMIT 1",
    "SELECT name, serial, status FROM ai_read.devices WHERE LOWER(name) LIKE '%sala%' LIMIT 50",
    "SELECT code, name, unit FROM ai_read.variables ORDER BY code LIMIT 10",
    "SELECT * FROM ai_read.environments LIMIT 5",
    "SELECT device_serial, sensor_key, sensor_model FROM ai_read.sensors LIMIT 200",
    "SELECT d.name FROM ai_read.devices AS d WHERE d.is_active = true LIMIT 5",
    "SELECT measured_at, value FROM ai_read.telemetry WHERE measured_at BETWEEN "
    "'2026-01-01T00:00:00Z' AND '2026-01-02T00:00:00Z' AND value > 20.5 LIMIT 10",
    "SELECT variable, AVG(value) AS promedio FROM ai_read.telemetry GROUP BY variable "
    "HAVING COUNT(*) > 3 ORDER BY promedio LIMIT 10",
    "SELECT COUNT(*) FROM ai_read.devices LIMIT 1;",
]


@pytest.mark.parametrize("sql", GOOD)
def test_accepts_the_supported_grammar(sql):
    validated = validate_sql(sql)
    assert isinstance(validated, ValidatedSQL)
    assert "ai_read." in validated.sql
    assert 1 <= validated.limit <= MAX_LIMIT


def test_validated_sql_is_the_rerendered_ast_not_the_submitted_text():
    validated = validate_sql("select   count(*)   from   ai_read.telemetry   limit   1")
    assert validated.sql == "SELECT COUNT(*) FROM ai_read.telemetry LIMIT 1"
    assert validated.view == "telemetry"
    assert validated.limit == 1


def test_validated_sql_cannot_be_constructed_by_hand():
    with pytest.raises(TypeError):
        ValidatedSQL(sql="SELECT 1", view="telemetry", limit=1)


HOSTILE = [
    # statements other than a single SELECT
    ("DELETE FROM public.telemetry", "statement"),
    ("INSERT INTO ai_read.devices (name) VALUES ('x')", "statement"),
    ("UPDATE ai_read.devices SET name = 'x'", "statement"),
    ("DROP TABLE public.telemetry", "statement"),
    ("CREATE TABLE x (a int)", "statement"),
    ("TRUNCATE public.telemetry", "statement"),
    ("COPY public.telemetry TO '/tmp/x'", "statement"),
    ("SET ROLE postgres", "statement"),
    ("RESET ROLE", "statement"),
    ("SELECT name FROM ai_read.devices LIMIT 1; DROP TABLE public.device", "statement"),
    ("SELECT name FROM ai_read.devices LIMIT 1; RESET ROLE", "statement"),
    ("SELECT name FROM ai_read.devices WHERE name = 'a;b' LIMIT 1", "statement"),
    ("SELECT name FROM ai_read.devices LIMIT 1;;", "statement"),
    ("SELECT name FROM ai_read.devices LIMIT 1; SELECT name FROM ai_read.devices LIMIT 1", "statement"),
    ("", "empty"),
    ("   ", "empty"),
    # comments
    ("SELECT name FROM ai_read.devices LIMIT 1 -- x", "comment"),
    ("SELECT name /* x */ FROM ai_read.devices LIMIT 1", "comment"),
    # dangerous functions and identity probing
    ("SELECT pg_sleep(5) FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT set_config('app.current_user_id', 'system_admin', false) FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT current_setting('app.current_user_id') FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT current_user FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT version() FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT pg_read_file('/etc/passwd') FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT lo_import('/etc/passwd') FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT dblink('x', 'select 1') FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT generate_series(1, 1000000) FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT upper(name) FROM ai_read.devices LIMIT 1", "function"),
    ("SELECT time_bucket('1 hour', measured_at) FROM ai_read.telemetry LIMIT 1", "function"),
    # system catalogs and base tables
    ("SELECT rolname FROM pg_catalog.pg_roles LIMIT 1", "view"),
    ("SELECT * FROM pg_roles LIMIT 1", "view"),
    ("SELECT table_name FROM information_schema.tables LIMIT 1", "view"),
    ("SELECT * FROM public.telemetry LIMIT 1", "view"),
    ("SELECT * FROM telemetry LIMIT 1", "view"),
    ("SELECT * FROM public.\"user\" LIMIT 1", "view"),
    ("SELECT * FROM document LIMIT 1", "view"),
    ("SELECT * FROM public.scoped_guest_relation LIMIT 1", "view"),
    ("SELECT * FROM ai_read.telemetry_visible LIMIT 1", "view"),
    ("SELECT * FROM otherdb.ai_read.devices LIMIT 1", "view"),
    ("SELECT * FROM ai_read.users LIMIT 1", "view"),
    ("SELECT 1 LIMIT 1", "view"),
    ("SELECT * FROM generate_series(1, 10) LIMIT 1", "view"),
    ("SELECT * FROM ai_read.devices TABLESAMPLE SYSTEM (50) LIMIT 1", "construct"),
    # columns outside the allowlist
    ("SELECT password FROM ai_read.devices LIMIT 1", "column"),
    ("SELECT ai_read.devices.password FROM ai_read.devices LIMIT 1", "column"),
    ("SELECT x.name FROM ai_read.devices LIMIT 1", "relation"),
    ("SELECT public.devices.name FROM ai_read.devices LIMIT 1", "relation"),
    # joins, subqueries, set operations, CTEs
    ("SELECT a.name FROM ai_read.devices a JOIN ai_read.environments b ON a.environment_id = b.id LIMIT 1", "construct"),
    ("SELECT name FROM ai_read.devices, ai_read.environments LIMIT 1", "view"),
    ("SELECT (SELECT pg_sleep(1)) FROM ai_read.devices LIMIT 1", "subquery"),
    ("SELECT name FROM (SELECT name FROM ai_read.devices) x LIMIT 1", "subquery"),
    ("SELECT name FROM ai_read.devices WHERE id IN (SELECT id FROM ai_read.devices) LIMIT 1", "subquery"),
    ("SELECT name FROM ai_read.devices LIMIT 1 UNION SELECT name FROM ai_read.devices LIMIT 1", "statement"),
    ("SELECT name FROM ai_read.devices INTERSECT SELECT name FROM ai_read.devices", "statement"),
    ("WITH x AS (SELECT name FROM ai_read.devices) SELECT name FROM x LIMIT 1", "cte"),
    ("WITH d AS (DELETE FROM public.device RETURNING *) SELECT 1 LIMIT 1", "cte"),
    # select forms
    ("SELECT name INTO x FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT name FROM ai_read.devices LIMIT 1 FOR UPDATE", "construct"),
    ("SELECT name FROM ai_read.devices LIMIT 1 OFFSET 5", "construct"),
    ("SELECT name FROM ai_read.devices WINDOW w AS (ORDER BY name) LIMIT 1", "construct"),
    ("SELECT ROW_NUMBER() OVER (ORDER BY name) FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT DISTINCT ON (name) name FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT CAST(name AS int) FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT name::int FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT name || 'x' FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT name ~ 'x' FROM ai_read.devices LIMIT 1", "construct"),
    ("SELECT $1 FROM ai_read.devices LIMIT 1", "construct"),
    # limit rules
    ("SELECT name FROM ai_read.devices", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT 201", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT 0", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT ALL", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT -1", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT 1 + 1", "limit"),
    ("SELECT name FROM ai_read.devices LIMIT (SELECT 1)", "subquery"),
    # relative time must be now() - INTERVAL '<n> unit'
    ("SELECT name FROM ai_read.devices WHERE updated > now() + INTERVAL '1 hour' LIMIT 1", "time"),
    ("SELECT name FROM ai_read.devices WHERE id > INTERVAL '1 hour' LIMIT 1", "time"),
    ("SELECT name FROM ai_read.devices WHERE id > now() - INTERVAL '99999 days' LIMIT 1", "time"),
    ("SELECT name FROM ai_read.devices WHERE id > now() - INTERVAL '1 year' LIMIT 1", "time"),
    ("SELECT name FROM ai_read.devices WHERE id > now() - INTERVAL '1 hour 5 minutes' LIMIT 1", "time"),
    ("SELECT date_trunc('century', measured_at) FROM ai_read.telemetry LIMIT 1", "function"),
    ("SELECT date_trunc(name, measured_at) FROM ai_read.telemetry LIMIT 1", "function"),
    # literal hazards
    ("SELECT name FROM ai_read.devices WHERE name = 'a\\' LIMIT 1", "literal"),
    ("SELECT name FROM ai_read.devices WHERE name = E'a\\x41' LIMIT 1", "literal"),
    ("SELECT name FROM ai_read.devices WHERE name LIKE name LIMIT 1", "construct"),
    ("SELECT name FROM ai_read.devices WHERE name = '\x00' LIMIT 1", "literal"),
]


@pytest.mark.parametrize(("sql", "_kind"), HOSTILE)
def test_rejects_hostile_or_out_of_grammar_sql(sql, _kind):
    with pytest.raises(SQLRejected) as caught:
        validate_sql(sql)
    assert caught.value.code
    assert caught.value.reason


def test_rejection_reasons_never_echo_the_submitted_sql_as_the_message_field():
    with pytest.raises(SQLRejected) as caught:
        validate_sql("SELECT secret_marker FROM ai_read.devices")
    assert "secret_marker" not in caught.value.public_message
    assert caught.value.public_message == "La consulta generada no está permitida."


def test_oversized_sql_is_rejected():
    with pytest.raises(SQLRejected):
        validate_sql("SELECT name FROM ai_read.devices WHERE name IN (" + ", ".join(["'x'"] * 2000) + ") LIMIT 1")


def test_non_string_input_is_rejected():
    with pytest.raises(SQLRejected):
        validate_sql(None)  # type: ignore[arg-type]


def test_validation_is_idempotent_on_its_own_output():
    first = validate_sql(GOOD[2])
    assert validate_sql(first.sql).sql == first.sql
