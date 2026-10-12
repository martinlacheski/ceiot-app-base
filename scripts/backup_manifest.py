#!/usr/bin/env python3
"""Manifest, checksum and restore-verification helper for the backup scripts.

Used by scripts/backup.sh and scripts/verificar-backup.sh (standard library
only; PostgreSQL is reached through ``docker exec <container> psql``).

The same ``collect_database`` function describes the live database (inside the
exported snapshot that pg_dump also uses) and the database restored in the
disposable container, so a verified backup is one whose restored copy produces
exactly the manifest written at backup time.

Subcommands:
  database        describe a database as JSON (optionally inside a snapshot)
  s3-exporter     print the S3 exporter run inside the backend container
  s3-extract      unpack the exporter tar stream into <backup>/s3/objects
  assemble        build manifest.json from its parts
  sums            write or check SHA256SUMS
  verify          restore into a disposable container and compare (verificacion.json)
  get             print one manifest field (for the shell scripts)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path, PurePosixPath
from typing import Any, Callable

SCHEMAS = ("public", "ai_read")
MANIFEST_FORMAT = 1
MANIFEST_FILE = "manifest.json"
SUMS_FILE = "SHA256SUMS"
VERIFICATION_FILE = "verificacion.json"
DUMP_FILE = "db.dump"
ROLES_FILE = "roles.sql"
PG_DUMP_LOG = "pg_dump.log"
S3_OBJECTS_DIR = "s3/objects"
# Files written after the checksums (or by the verification itself).
UNSUMMED = {SUMS_FILE, VERIFICATION_FILE}
RESTORE_DUMP_PATH = "/tmp/ceiot-backup-restore.dump"

SNAPSHOT_RE = re.compile(r"^[0-9A-Fa-f]+(?:-[0-9A-Fa-f]+)+$")
DOCUMENT_KEY_RE = re.compile(r"^documents/[^/]+/([0-9a-f]{64})\.[^/]+$")
CHUNK = 1024 * 1024

# Deterministic text output, so the row fingerprints computed on the live and
# on the restored database are comparable. row_security=off makes a role that
# would be filtered by RLS fail loudly instead of counting a subset.
SESSION_PROLOGUE = """\
SET TIME ZONE 'UTC';
SET datestyle = 'ISO, YMD';
SET intervalstyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';
SET row_security = off;
SET statement_timeout = 0;
"""


class HelperError(RuntimeError):
    """A step failed; the message is safe to show to the operator."""


# ---------------------------------------------------------------------------
# SQL helpers


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def is_valid_snapshot(snapshot: str) -> bool:
    return bool(SNAPSHOT_RE.match(snapshot))


def _schemas_array() -> str:
    return "ARRAY[" + ", ".join(quote_literal(s) for s in SCHEMAS) + "]::name[]"


class Psql:
    """Runs SQL through ``docker exec -i <container> psql`` (unix socket)."""

    def __init__(self, container: str, user: str, database: str, snapshot: str | None = None):
        if snapshot is not None and not is_valid_snapshot(snapshot):
            raise HelperError(f"Identificador de snapshot inválido: {snapshot!r}")
        self.container = container
        self.user = user
        self.database = database
        self.snapshot = snapshot

    def _command(self, database: str | None = None) -> list[str]:
        return [
            "docker", "exec", "-i", self.container,
            "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
            "-U", self.user, "-d", database or self.database,
        ]

    def query(self, sql: str) -> list[str]:
        """Read-only statements inside one REPEATABLE READ transaction."""
        script = SESSION_PROLOGUE + "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
        if self.snapshot:
            script += f"SET TRANSACTION SNAPSHOT {quote_literal(self.snapshot)};\n"
        script += sql + "\nCOMMIT;\n"
        return self._run(script)

    def execute(self, sql: str, database: str | None = None) -> list[str]:
        """Autocommit statements (CREATE DATABASE, roles, extensions)."""
        return self._run(sql, database)

    def _run(self, script: str, database: str | None = None) -> list[str]:
        proc = subprocess.run(
            self._command(database), input=script, capture_output=True, text=True, check=False
        )
        if proc.returncode != 0:
            detail = proc.stderr.strip()[-2000:] or f"código {proc.returncode}"
            raise HelperError(f"psql falló: {detail}")
        return [line for line in proc.stdout.splitlines() if line.strip()]


def _single_json(lines: list[str]) -> Any:
    if len(lines) != 1:
        raise HelperError(f"Se esperaba una fila JSON y llegaron {len(lines)}")
    return json.loads(lines[0])


# ---------------------------------------------------------------------------
# Database description


def catalog_sql() -> str:
    schemas = _schemas_array()
    return f"""
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'database', (
    SELECT json_build_object(
      'encoding', pg_encoding_to_char(d.encoding),
      'collate', d.datcollate,
      'ctype', d.datctype,
      'owner', pg_get_userbyid(d.datdba))
    FROM pg_database d WHERE d.datname = current_database()),
  'extensions', (
    SELECT json_object_agg(e.extname, json_build_object('version', e.extversion, 'schema', n.nspname))
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace),
  'schemas', (
    SELECT json_object_agg(n.nspname, json_build_object('owner', pg_get_userbyid(n.nspowner), 'acl', n.nspacl::text))
    FROM pg_namespace n WHERE n.nspname = ANY({schemas})),
  'relations', (
    SELECT json_object_agg(n.nspname || '.' || c.relname, json_build_object(
      'kind', c.relkind,
      'owner', pg_get_userbyid(c.relowner),
      'acl', c.relacl::text,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'columns', (
        SELECT json_agg(json_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull) ORDER BY a.attnum)
        FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'primary_key', (
        SELECT json_agg(a.attname ORDER BY k.ord)
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE i.indrelid = c.oid AND i.indisprimary),
      'indexes', (
        SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid))
        FROM pg_index i WHERE i.indrelid = c.oid),
      -- CHECK bodies are compared by name only: PostgreSQL does not deparse
      -- some expressions idempotently (ANY (ARRAY[...]) gains casts after a
      -- dump/restore round trip). Keys and foreign keys keep their definition.
      'constraints', (
        SELECT json_agg(co.conname || ': ' || CASE WHEN co.contype = 'c' THEN 'CHECK'
                                                   ELSE pg_get_constraintdef(co.oid) END
                        ORDER BY co.conname)
        FROM pg_constraint co WHERE co.conrelid = c.oid),
      'triggers', (
        SELECT json_agg(tg.tgname ORDER BY tg.tgname)
        FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal),
      'definition_md5', CASE WHEN c.relkind IN ('v', 'm') THEN md5(pg_get_viewdef(c.oid)) END))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY({schemas}) AND c.relkind IN ('r', 'p', 'v', 'm')),
  'policies', (
    SELECT json_object_agg(p.schemaname || '.' || p.tablename || '.' || p.policyname, json_build_object(
      'permissive', p.permissive,
      'roles', p.roles,
      'cmd', p.cmd,
      'qual_md5', md5(coalesce(p.qual, '')),
      'with_check_md5', md5(coalesce(p.with_check, ''))))
    FROM pg_policies p WHERE p.schemaname = ANY({schemas})),
  'roles', (
    SELECT json_object_agg(r.rolname, json_build_object(
      'superuser', r.rolsuper,
      'login', r.rolcanlogin,
      'inherit', r.rolinherit,
      'createrole', r.rolcreaterole,
      'createdb', r.rolcreatedb,
      'bypassrls', r.rolbypassrls,
      'member_of', (
        SELECT json_agg(b.rolname ORDER BY b.rolname)
        FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid
        WHERE m.member = r.oid)))
    FROM pg_roles r WHERE r.rolname !~ '^pg_'),
  'required_roles', (
    SELECT json_agg(DISTINCT x.rolname ORDER BY x.rolname) FROM (
      SELECT pg_get_userbyid(c.relowner)::text AS rolname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY({schemas}) AND c.relkind IN ('r', 'p', 'v', 'm')
      UNION SELECT pg_get_userbyid(a.grantee)::text
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = ANY({schemas}) AND a.grantee <> 0
      UNION SELECT pg_get_userbyid(n.nspowner)::text
        FROM pg_namespace n WHERE n.nspname = ANY({schemas})
      UNION SELECT pg_get_userbyid(a.grantee)::text
        FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
        WHERE n.nspname = ANY({schemas}) AND a.grantee <> 0
      UNION SELECT unnest(p.roles)::text FROM pg_policies p WHERE p.schemaname = ANY({schemas})
      UNION SELECT pg_get_userbyid(d.datdba)::text FROM pg_database d WHERE d.datname = current_database()
    ) x WHERE x.rolname <> 'public' AND x.rolname !~ '^pg_')
);
"""


TIMESCALE_SQL = """
SELECT json_build_object(
  'hypertables', (
    SELECT json_object_agg(h.hypertable_schema || '.' || h.hypertable_name, json_build_object(
      'num_chunks', h.num_chunks,
      'num_dimensions', h.num_dimensions,
      'compression_enabled', h.compression_enabled,
      'compressed_chunks', (
        SELECT count(*) FROM timescaledb_information.chunks ch
        WHERE ch.hypertable_schema = h.hypertable_schema
          AND ch.hypertable_name = h.hypertable_name AND ch.is_compressed),
      'dimensions', (
        SELECT json_agg(json_build_object(
          'column', d.column_name,
          'type', d.column_type::text,
          'dimension_type', d.dimension_type,
          'time_interval', d.time_interval::text,
          'integer_interval', d.integer_interval,
          'num_partitions', d.num_partitions) ORDER BY d.dimension_number)
        FROM timescaledb_information.dimensions d
        WHERE d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name),
      'compression_settings', (
        SELECT json_agg(json_build_object(
          'column', s.attname,
          'segmentby_index', s.segmentby_column_index,
          'orderby_index', s.orderby_column_index,
          'orderby_asc', s.orderby_asc,
          'orderby_nullsfirst', s.orderby_nullsfirst) ORDER BY s.attname)
        FROM timescaledb_information.compression_settings s
        WHERE s.hypertable_schema = h.hypertable_schema AND s.hypertable_name = h.hypertable_name)))
    FROM timescaledb_information.hypertables h),
  'jobs', (
    SELECT json_agg(json_build_object(
      'proc', j.proc_schema || '.' || j.proc_name,
      'hypertable', j.hypertable_schema || '.' || j.hypertable_name,
      'schedule_interval', j.schedule_interval::text,
      'config', j.config,
      'scheduled', j.scheduled)
      ORDER BY j.hypertable_schema, j.hypertable_name, j.proc_name, j.config::text)
    FROM timescaledb_information.jobs j WHERE j.hypertable_name IS NOT NULL),
  'continuous_aggregates', (
    SELECT json_object_agg(c.view_schema || '.' || c.view_name, json_build_object(
      'materialized_only', c.materialized_only,
      'definition_md5', md5(c.view_definition),
      'materialization_hypertable', c.materialization_hypertable_schema || '.' || c.materialization_hypertable_name))
    FROM timescaledb_information.continuous_aggregates c)
);
"""

ROW_HASH = "('x' || substr(md5(t::text), 1, 15))::bit(60)::bigint"


def relation_stats_sql(
    name: str, kind: str, primary_key: list[str] | None, time_column: str | None
) -> str:
    """One JSON row describing the content of a table, hypertable or view.

    Every table gets an exact count and an order-independent fingerprint of
    the full row text. Regular tables also get an md5 of the rows ordered by
    primary key; hypertables get their time range instead (they can be big).
    """
    schema, _, table = name.partition(".")
    source = f"{quote_ident(schema)}.{quote_ident(table)}"
    fields = [f"'relation', {quote_literal(name)}", "'rows', count(*)"]
    if kind in ("v", "m"):
        return f"SELECT json_build_object({', '.join(fields)}) FROM {source} AS t;"
    fields.append(f"'row_hash_sum', coalesce(sum({ROW_HASH}), 0)::text")
    if time_column:
        column = "t." + quote_ident(time_column)
        fields.append(f"'min_time', min({column})::text")
        fields.append(f"'max_time', max({column})::text")
    else:
        if primary_key:
            order = ", ".join("t." + quote_ident(c) for c in primary_key)
        else:
            order = 'md5(t::text) COLLATE "C"'
        fields.append(f"'ordered_md5', md5(coalesce(string_agg(md5(t::text), '' ORDER BY {order}), ''))")
    return f"SELECT json_build_object({', '.join(fields)}) FROM {source} AS t;"


def _none_to(value: Any, default: Any) -> Any:
    return default if value is None else value


def collect_database(psql: Psql) -> dict[str, Any]:
    """Describe the database: catalog, row fingerprints and TimescaleDB state."""
    catalog = _single_json(psql.query(catalog_sql()))
    for key in ("extensions", "schemas", "relations", "policies", "roles"):
        catalog[key] = _none_to(catalog.get(key), {})
    catalog["required_roles"] = _none_to(catalog.get("required_roles"), [])
    for relation in catalog["relations"].values():
        for key in ("columns", "primary_key", "indexes", "constraints", "triggers"):
            relation[key] = _none_to(relation.get(key), [])

    timescale: dict[str, Any] | None = None
    time_columns: dict[str, str] = {}
    if "timescaledb" in catalog["extensions"]:
        timescale = _single_json(psql.query(TIMESCALE_SQL))
        timescale["hypertables"] = _none_to(timescale.get("hypertables"), {})
        timescale["jobs"] = _none_to(timescale.get("jobs"), [])
        timescale["continuous_aggregates"] = _none_to(timescale.get("continuous_aggregates"), {})
        for name, info in timescale["hypertables"].items():
            info["dimensions"] = _none_to(info.get("dimensions"), [])
            info["compression_settings"] = _none_to(info.get("compression_settings"), [])
            for dimension in info["dimensions"]:
                if dimension.get("dimension_type") == "Time":
                    time_columns[name] = dimension["column"]
                    break

    statements = []
    for name in sorted(catalog["relations"]):
        relation = catalog["relations"][name]
        statements.append(
            relation_stats_sql(name, relation["kind"], relation["primary_key"], time_columns.get(name))
        )
    if "public.alembic_version" in catalog["relations"]:
        statements.append(
            "SELECT json_build_object('alembic_version', "
            "(SELECT json_agg(version_num ORDER BY version_num) FROM public.alembic_version));"
        )
    reference_tables = [
        name
        for name, relation in sorted(catalog["relations"].items())
        if relation["kind"] in ("r", "p")
        and {"storage_key", "sha256"} <= {c["name"] for c in relation["columns"]}
    ]
    for name in reference_tables:
        schema, _, table = name.partition(".")
        statements.append(
            "SELECT json_build_object('object_references', (SELECT json_agg(json_build_object("
            f"'table', {quote_literal(name)}, 'key', t.storage_key, 'sha256', t.sha256) "
            f"ORDER BY t.storage_key) FROM {quote_ident(schema)}.{quote_ident(table)} AS t "
            "WHERE coalesce(t.storage_key, '') <> ''));"
        )

    stats: dict[str, Any] = {}
    alembic: list[str] = []
    references: list[dict[str, str]] = []
    for line in psql.query("\n".join(statements)):
        row = json.loads(line)
        if "relation" in row:
            stats[row.pop("relation")] = row
        elif "alembic_version" in row:
            alembic = _none_to(row["alembic_version"], [])
        elif "object_references" in row:
            references.extend(_none_to(row["object_references"], []))
    references.sort(key=lambda r: (r["key"], r["table"]))

    catalog["stats"] = stats
    catalog["alembic_version"] = alembic
    catalog["object_references"] = references
    catalog["timescaledb"] = timescale
    return catalog


# ---------------------------------------------------------------------------
# Comparison


def _format_value(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= 160 else text[:157] + "..."


def compare(expected: Any, actual: Any, path: str = "database") -> list[str]:
    """Exact structural diff; every difference is one readable line."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        differences = []
        for key in sorted(set(expected) | set(actual)):
            child = f"{path}[{key}]" if "." in key or "/" in key else f"{path}.{key}"
            if key not in actual:
                differences.append(f"{child}: falta en la base restaurada")
            elif key not in expected:
                differences.append(f"{child}: aparece en la base restaurada y no en el manifiesto")
            else:
                differences.extend(compare(expected[key], actual[key], child))
        return differences
    if isinstance(expected, list) and isinstance(actual, list) and len(expected) == len(actual):
        differences = []
        for index, (left, right) in enumerate(zip(expected, actual)):
            differences.extend(compare(left, right, f"{path}[{index}]"))
        return differences
    if expected != actual:
        return [f"{path}: esperado {_format_value(expected)}, obtenido {_format_value(actual)}"]
    return []


# ---------------------------------------------------------------------------
# Roles


def filter_roles(sql: str, bootstrap_user: str) -> str:
    """Drop the CREATE ROLE of the bootstrap superuser (the disposable
    container already has it); its ALTER ROLE, memberships and every other
    role are kept. The dump has no passwords (--no-role-passwords)."""
    names = {bootstrap_user, quote_ident(bootstrap_user)}
    kept = []
    for line in sql.splitlines():
        match = re.match(r"^CREATE ROLE (.+);$", line.strip())
        if match and match.group(1) in names:
            continue
        kept.append(line)
    return "\n".join(kept) + "\n"


# ---------------------------------------------------------------------------
# Checksums


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_files(backup: Path) -> list[str]:
    files = []
    for path in sorted(backup.rglob("*")):
        if path.is_file():
            relative = path.relative_to(backup).as_posix()
            if relative not in UNSUMMED:
                files.append(relative)
    return files


def write_sums(backup: Path) -> None:
    lines = [f"{sha256_file(backup / name)}  {name}\n" for name in artifact_files(backup)]
    (backup / SUMS_FILE).write_text("".join(lines), encoding="utf-8")


def check_sums(backup: Path) -> list[str]:
    sums_path = backup / SUMS_FILE
    if not sums_path.is_file():
        return [f"Falta {SUMS_FILE}"]
    reasons = []
    listed: dict[str, str] = {}
    for number, line in enumerate(sums_path.read_text(encoding="utf-8").splitlines(), 1):
        match = re.match(r"^([0-9a-f]{64})  (.+)$", line)
        if not match:
            reasons.append(f"{SUMS_FILE}: línea {number} con formato inválido")
            continue
        listed[match.group(2)] = match.group(1)
    for name, digest in sorted(listed.items()):
        path = backup / name
        if not path.is_file():
            reasons.append(f"Falta el archivo {name} (listado en {SUMS_FILE})")
        elif sha256_file(path) != digest:
            reasons.append(f"Checksum distinto en {name}: el archivo cambió o está corrupto")
    for name in artifact_files(backup):
        if name not in listed:
            reasons.append(f"El archivo {name} no figura en {SUMS_FILE}")
    return reasons


# ---------------------------------------------------------------------------
# S3 objects

# Runs inside the backend container (it has boto3 and the S3 settings). It
# writes a tar stream to stdout: objects/<key> for every object plus
# index.json (size, ETag and the sha256 metadata the backend stores on
# upload). Credentials never leave the container. Exit 3: not configured;
# exit 4: unreachable. A one-line JSON status goes to stderr.
S3_EXPORTER = r'''
import json, os, sys, tarfile

def status(code, state, reason):
    sys.stderr.write(json.dumps({"status": state, "reason": reason}) + "\n")
    sys.exit(code)

endpoint = os.environ.get("S3_ENDPOINT_URL")
access = os.environ.get("S3_ACCESS_KEY")
secret = os.environ.get("S3_SECRET_KEY")
bucket = os.environ.get("S3_BUCKET") or "ceiot-documents"
region = os.environ.get("S3_REGION") or "us-east-1"
if not (endpoint and access and secret):
    status(3, "skipped", "S3 no configurado en el backend (S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY)")

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

client = boto3.client(
    "s3", endpoint_url=endpoint, aws_access_key_id=access, aws_secret_access_key=secret,
    region_name=region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                  retries={"max_attempts": 2, "mode": "standard"},
                  connect_timeout=5, read_timeout=60),
)
index = {"bucket": bucket, "objects": {}}
try:
    keys = []
    try:
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
            keys.extend(item["Key"] for item in page.get("Contents", []))
    except ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) not in ("404", "NoSuchBucket"):
            raise
        index["bucket_missing"] = True
except (BotoCoreError, ClientError) as error:
    status(4, "unavailable", "No se pudo listar el bucket: " + type(error).__name__ + ": " + str(error)[:300])

out = tarfile.open(fileobj=sys.stdout.buffer, mode="w|")
for key in sorted(keys):
    obj = client.get_object(Bucket=bucket, Key=key)
    info = tarfile.TarInfo("objects/" + key)
    info.size = obj["ContentLength"]
    info.mtime = int(obj["LastModified"].timestamp())
    out.addfile(info, obj["Body"])
    obj["Body"].close()
    index["objects"][key] = {
        "size": obj["ContentLength"],
        "etag": obj.get("ETag", "").strip('"'),
        "metadata_sha256": obj.get("Metadata", {}).get("sha256"),
    }
data = json.dumps(index, sort_keys=True).encode()
info = tarfile.TarInfo("index.json")
info.size = len(data)
import io
out.addfile(info, io.BytesIO(data))
out.close()
sys.stdout.buffer.flush()
'''


def _safe_key(key: str) -> bool:
    if not key or key.startswith("/") or "\\" in key:
        return False
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in key):
        return False
    return all(part not in ("", ".", "..") for part in PurePosixPath(key).parts) and not key.endswith("/")


def _parse_exporter_status(stderr: str) -> dict[str, str]:
    for line in reversed(stderr.strip().splitlines()):
        try:
            data = json.loads(line)
        except ValueError:
            continue
        if isinstance(data, dict) and "status" in data:
            return {"status": str(data["status"]), "reason": str(data.get("reason", ""))}
    return {}


def extract_s3(tar_path: Path, dest: Path, exit_code: int, stderr: str) -> dict[str, Any]:
    """Unpack the exporter stream and describe the copied objects."""
    reported = _parse_exporter_status(stderr)
    if exit_code == 3:
        return {"status": "skipped", "reason": reported.get("reason") or "S3 no configurado"}
    if exit_code == 4:
        return {"status": "unavailable", "reason": reported.get("reason") or "S3 inaccesible"}
    if exit_code != 0:
        tail = stderr.strip().splitlines()[-1:] if stderr.strip() else []
        return {
            "status": "error",
            "reason": f"El exportador S3 terminó con código {exit_code}" + (f": {tail[0][:300]}" if tail else ""),
        }

    objects: dict[str, dict[str, Any]] = {}
    index: dict[str, Any] | None = None
    errors: list[str] = []
    try:
        with tarfile.open(tar_path, mode="r|") as archive:
            for member in archive:
                if member.name == "index.json" and member.isfile():
                    handle = archive.extractfile(member)
                    index = json.loads(handle.read().decode("utf-8")) if handle else None
                    continue
                if not member.isfile() or not member.name.startswith("objects/"):
                    errors.append(f"Entrada inesperada en el flujo S3: {member.name!r}")
                    continue
                key = member.name[len("objects/"):]
                if not _safe_key(key):
                    errors.append(f"Clave S3 insegura descartada: {key!r}")
                    continue
                target = dest / key
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                size = 0
                handle = archive.extractfile(member)
                with target.open("wb") as out:
                    while handle and (chunk := handle.read(CHUNK)):
                        digest.update(chunk)
                        size += len(chunk)
                        out.write(chunk)
                objects[key] = {"size": size, "sha256": digest.hexdigest()}
    except (tarfile.TarError, OSError, ValueError) as error:
        errors.append(f"El flujo S3 está incompleto o dañado: {type(error).__name__}: {error}")

    if index is None:
        errors.append("El flujo S3 no trae index.json (copia incompleta)")
        index = {"objects": {}}
    for key, meta in sorted(index.get("objects", {}).items()):
        copied = objects.get(key)
        if copied is None:
            errors.append(f"Objeto S3 sin copiar: {key}")
            continue
        if copied["size"] != meta.get("size"):
            errors.append(f"Objeto S3 {key}: tamaño copiado {copied['size']}, en el bucket {meta.get('size')}")
        stored = meta.get("metadata_sha256")
        if stored and stored != copied["sha256"]:
            errors.append(f"Objeto S3 {key}: sha256 copiado distinto del registrado al subirlo")
        copied["etag"] = meta.get("etag")
        copied["metadata_sha256"] = stored
    for key in objects:
        if key not in index.get("objects", {}):
            errors.append(f"Objeto S3 {key} copiado sin figurar en el índice")

    section: dict[str, Any] = {
        "status": "error" if errors else "ok",
        "bucket": index.get("bucket"),
        "objects": dict(sorted(objects.items())),
    }
    if index.get("bucket_missing"):
        section["bucket_missing"] = True
    if errors:
        section["errors"] = errors
    return section


def check_s3(backup: Path, manifest: dict[str, Any], references: list[dict[str, str]]) -> tuple[list[str], list[str]]:
    """Verify the saved objects against the manifest and the DB references.

    Returns (reasons, warnings)."""
    s3 = manifest.get("s3") or {"status": "missing"}
    status = s3.get("status")
    reasons: list[str] = []
    warnings: list[str] = []
    if status != "ok":
        detail = s3.get("reason") or "; ".join(s3.get("errors", [])) or status
        if status == "excluded":
            if references:
                warnings.append(
                    f"Objetos S3 excluidos a pedido (--sin-s3): la base referencia {len(references)} objeto(s) que no están en este backup"
                )
            else:
                warnings.append("Objetos S3 excluidos a pedido (--sin-s3)")
        elif references:
            reasons.append(
                f"Copia S3 {status} ({detail}): la base referencia {len(references)} objeto(s) que no están en el backup"
            )
        else:
            warnings.append(f"Copia S3 {status} ({detail}); la base no referencia objetos")
        return reasons, warnings

    objects = s3.get("objects", {})
    root = backup / S3_OBJECTS_DIR
    for key, meta in sorted(objects.items()):
        path = root / key
        if not _safe_key(key) or not path.is_file():
            reasons.append(f"Falta el objeto S3 {key}")
            continue
        size = path.stat().st_size
        if size != meta.get("size"):
            reasons.append(f"Objeto S3 {key}: tamaño {size}, el manifiesto dice {meta.get('size')}")
        digest = sha256_file(path)
        if digest != meta.get("sha256"):
            reasons.append(f"Objeto S3 {key}: sha256 distinto del manifiesto")
        match = DOCUMENT_KEY_RE.match(key)
        if match and match.group(1) != digest:
            reasons.append(f"Objeto S3 {key}: el contenido no coincide con el sha256 de su clave")
    if root.is_dir():
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.relative_to(root).as_posix() not in objects:
                reasons.append(f"Objeto S3 {path.relative_to(root).as_posix()} no figura en el manifiesto")
    for reference in references:
        meta = objects.get(reference["key"])
        if meta is None:
            reasons.append(f"{reference['table']} referencia {reference['key']} y el objeto no está en el backup")
        elif meta.get("sha256") != reference.get("sha256"):
            reasons.append(f"{reference['table']}: el sha256 de {reference['key']} no coincide con el objeto copiado")
    referenced = {r["key"] for r in references}
    orphans = [key for key in objects if key not in referenced]
    if orphans:
        warnings.append(f"{len(orphans)} objeto(s) S3 sin referencia en la base (huérfanos o posteriores al snapshot)")
    return reasons, warnings


# ---------------------------------------------------------------------------
# Verification (restore into the disposable container)


def _timed(steps: dict[str, Any], name: str, function: Callable[[], Any]) -> Any:
    started = time.monotonic()
    try:
        result = function()
    except Exception:
        steps[name] = {"ok": False, "seconds": round(time.monotonic() - started, 2)}
        raise
    steps[name] = {"ok": True, "seconds": round(time.monotonic() - started, 2)}
    return result


def restore_and_describe(
    backup: Path, manifest: dict[str, Any], container: str, steps: dict[str, Any], warnings: list[str]
) -> dict[str, Any]:
    source = manifest["source"]
    expected = manifest["database"]
    user, dbname = source["user"], source["database"]
    admin = Psql(container, user, "postgres")

    roles_sql = filter_roles((backup / ROLES_FILE).read_text(encoding="utf-8"), user)
    _timed(steps, "roles", lambda: admin.execute(roles_sql))

    info = expected["database"]
    create_db = (
        f"CREATE DATABASE {quote_ident(dbname)} TEMPLATE template0 OWNER {quote_ident(info['owner'])} "
        f"ENCODING {quote_literal(info['encoding'])} LC_COLLATE {quote_literal(info['collate'])} "
        f"LC_CTYPE {quote_literal(info['ctype'])};"
    )
    _timed(steps, "create_database", lambda: admin.execute(create_db))

    extensions = expected.get("extensions", {})
    ordered = sorted(extensions, key=lambda name: (name != "timescaledb", name))
    statements = [
        f"CREATE EXTENSION IF NOT EXISTS {quote_ident(name)} WITH SCHEMA "
        f"{quote_ident(extensions[name]['schema'])} VERSION {quote_literal(extensions[name]['version'])};"
        for name in ordered
        if name != "plpgsql"
    ]
    if "timescaledb" in extensions:
        statements.append("SELECT timescaledb_pre_restore();")
    _timed(steps, "extensions", lambda: admin.execute("\n".join(statements), dbname))

    def copy_dump() -> None:
        proc = subprocess.run(
            ["docker", "cp", str(backup / DUMP_FILE), f"{container}:{RESTORE_DUMP_PATH}"],
            capture_output=True, text=True, check=False,
        )
        if proc.returncode != 0:
            raise HelperError(f"No se pudo copiar el dump al contenedor: {proc.stderr.strip()[-500:]}")

    _timed(steps, "copy_dump", copy_dump)

    def pg_restore() -> None:
        proc = subprocess.run(
            ["docker", "exec", container, "pg_restore", "--exit-on-error", "--no-password",
             "-U", user, "-d", dbname, RESTORE_DUMP_PATH],
            capture_output=True, text=True, check=False,
        )
        lines = [line for line in proc.stderr.splitlines() if line.strip()]
        steps["pg_restore_exit_code"] = proc.returncode
        steps["pg_restore_stderr"] = lines[-50:]
        errors = [line for line in lines if re.search(r"\berror\b", line, re.IGNORECASE)]
        if proc.returncode != 0 or errors:
            detail = (errors or lines or [f"código {proc.returncode}"])[0]
            raise HelperError(f"pg_restore falló (código {proc.returncode}): {detail[:500]}")
        if lines:
            warnings.append(f"pg_restore emitió {len(lines)} aviso(s) sin errores")

    _timed(steps, "pg_restore", pg_restore)
    if "timescaledb" in extensions:
        _timed(steps, "post_restore", lambda: admin.execute("SELECT timescaledb_post_restore();", dbname))

    return _timed(steps, "describe_restored", lambda: collect_database(Psql(container, user, dbname)))


def verify(backup: Path, container: str | None, setup_error: str | None) -> dict[str, Any]:
    started = time.monotonic()
    reasons: list[str] = []
    warnings: list[str] = []
    steps: dict[str, Any] = {}
    report: dict[str, Any] = {
        "verified_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "backup": str(backup),
        "container": container,
    }

    manifest: dict[str, Any] | None = None
    try:
        manifest = json.loads((backup / MANIFEST_FILE).read_text(encoding="utf-8"))
        if manifest.get("format") != MANIFEST_FORMAT:
            reasons.append(f"Formato de manifiesto no soportado: {manifest.get('format')!r}")
            manifest = None
    except (OSError, ValueError) as error:
        reasons.append(f"No se pudo leer {MANIFEST_FILE}: {error}")

    reasons.extend(_timed(steps, "checksums", lambda: check_sums(backup)))

    restored: dict[str, Any] | None = None
    if setup_error:
        reasons.append(setup_error)
    elif manifest is not None and container:
        report["image"] = manifest.get("source", {}).get("image")
        try:
            restored = restore_and_describe(backup, manifest, container, steps, warnings)
        except (HelperError, OSError, KeyError, ValueError) as error:
            reasons.append(f"La restauración falló: {error}")

    if manifest is not None and restored is not None:
        differences = compare(manifest["database"], restored)
        report["differences"] = differences
        if differences:
            shown = differences[:20]
            more = f" (y {len(differences) - len(shown)} más)" if len(differences) > len(shown) else ""
            reasons.append(
                f"La base restaurada no coincide con el manifiesto en {len(differences)} punto(s){more}: "
                + "; ".join(shown)
            )

    if manifest is not None:
        references = (restored or manifest["database"]).get("object_references", [])
        s3_reasons, s3_warnings = _timed(steps, "s3", lambda: check_s3(backup, manifest, references))
        reasons.extend(s3_reasons)
        warnings.extend(s3_warnings)
        if restored is not None:
            stats = restored.get("stats", {})
            report["summary"] = {
                "tables": sum(1 for r in restored["relations"].values() if r["kind"] in ("r", "p")),
                "rows": sum(stats[n]["rows"] for n, r in restored["relations"].items()
                            if r["kind"] in ("r", "p") and n in stats),
                "hypertables": len((restored.get("timescaledb") or {}).get("hypertables", {})),
                "rls_policies": len(restored.get("policies", {})),
                "alembic_version": restored.get("alembic_version"),
                "s3_objects": len((manifest.get("s3") or {}).get("objects", {})),
            }

    report["ok"] = not reasons
    report["reasons"] = reasons
    report["warnings"] = warnings
    report["steps"] = steps
    report["seconds"] = round(time.monotonic() - started, 2)
    return report


def summary_text(report: dict[str, Any]) -> str:
    if report["ok"]:
        summary = report.get("summary", {})
        line = (
            f"✅ Backup verificado: {report['backup']} se restauró sin errores y coincide con su manifiesto "
            f"({summary.get('tables', '?')} tablas, {summary.get('rows', '?')} filas, "
            f"{summary.get('hypertables', '?')} hypertables, {summary.get('rls_policies', '?')} políticas RLS, "
            f"{summary.get('s3_objects', 0)} objetos S3; Alembic {', '.join(summary.get('alembic_version') or ['-'])})."
        )
    else:
        line = "❌ Backup inválido: " + report["reasons"][0]
        if len(report["reasons"]) > 1:
            line += "\n" + "\n".join(f"  - {reason}" for reason in report["reasons"][1:])
    if report.get("warnings"):
        line += "\n" + "\n".join(f"  Aviso: {warning}" for warning in report["warnings"])
    return line


# ---------------------------------------------------------------------------
# CLI


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def cmd_database(args: argparse.Namespace) -> int:
    data = collect_database(Psql(args.container, args.user, args.db, args.snapshot))
    _write_json(Path(args.out), data)
    return 0


def cmd_s3_exporter(_: argparse.Namespace) -> int:
    sys.stdout.write(S3_EXPORTER)
    return 0


def cmd_s3_extract(args: argparse.Namespace) -> int:
    stderr = Path(args.stderr).read_text(encoding="utf-8", errors="replace") if args.stderr else ""
    section = extract_s3(Path(args.tar), Path(args.dest), args.exit_code, stderr)
    _write_json(Path(args.out), section)
    return 0


def cmd_assemble(args: argparse.Namespace) -> int:
    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    manifest = {
        "format": MANIFEST_FORMAT,
        **meta,
        "artifacts": {"dump": DUMP_FILE, "roles": ROLES_FILE, "pg_dump_log": PG_DUMP_LOG},
        "database": json.loads(Path(args.database).read_text(encoding="utf-8")),
        "s3": json.loads(Path(args.s3).read_text(encoding="utf-8")),
    }
    _write_json(Path(args.out), manifest)
    return 0


def cmd_sums(args: argparse.Namespace) -> int:
    backup = Path(args.backup)
    if args.action == "write":
        write_sums(backup)
        return 0
    reasons = check_sums(backup)
    for reason in reasons:
        print(reason)
    return 1 if reasons else 0


def cmd_verify(args: argparse.Namespace) -> int:
    backup = Path(args.backup)
    report = verify(backup, args.container, args.setup_error)
    text = summary_text(report)
    report["resumen"] = text
    try:
        _write_json(backup / VERIFICATION_FILE, report)
    except OSError as error:
        text += f"\n  Aviso: no se pudo escribir {VERIFICATION_FILE}: {error}"
    print(text)
    return 0 if report["ok"] else 1


def cmd_get(args: argparse.Namespace) -> int:
    try:
        value: Any = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        for part in args.field.split("."):
            value = value[part]
    except (OSError, ValueError, KeyError, TypeError):
        return 1
    print(value if value is not None else "")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    database = sub.add_parser("database")
    database.add_argument("--container", required=True)
    database.add_argument("--user", required=True)
    database.add_argument("--db", required=True)
    database.add_argument("--snapshot")
    database.add_argument("--out", required=True)
    database.set_defaults(func=cmd_database)

    exporter = sub.add_parser("s3-exporter")
    exporter.set_defaults(func=cmd_s3_exporter)

    extract = sub.add_parser("s3-extract")
    extract.add_argument("--tar", required=True)
    extract.add_argument("--dest", required=True)
    extract.add_argument("--exit-code", type=int, required=True)
    extract.add_argument("--stderr")
    extract.add_argument("--out", required=True)
    extract.set_defaults(func=cmd_s3_extract)

    assemble = sub.add_parser("assemble")
    assemble.add_argument("--meta", required=True)
    assemble.add_argument("--database", required=True)
    assemble.add_argument("--s3", required=True)
    assemble.add_argument("--out", required=True)
    assemble.set_defaults(func=cmd_assemble)

    sums = sub.add_parser("sums")
    sums.add_argument("action", choices=("write", "check"))
    sums.add_argument("backup")
    sums.set_defaults(func=cmd_sums)

    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--backup", required=True)
    verify_parser.add_argument("--container")
    verify_parser.add_argument("--setup-error")
    verify_parser.set_defaults(func=cmd_verify)

    get = sub.add_parser("get")
    get.add_argument("manifest")
    get.add_argument("field")
    get.set_defaults(func=cmd_get)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except HelperError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
