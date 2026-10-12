"""the application connects as its own unprivileged role; migrations keep the superuser

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-12

Until now the API and mqtt-runtime connected as the superuser that also ran the migrations, so
Row Level Security never filtered their requests. From this revision the migration role (the
image's ``POSTGRES_USER``, ``ALEMBIC_DB_USER``) owns every object and the application logs in
as ``DB_APP_ROLE`` (``DB_USER`` in compose, default ``iot_app``): no SUPERUSER, no BYPASSRLS,
so every policy and the telemetry views' predicate apply to it.

upgrade() grants that role exactly what the application uses:

* ``CONNECT`` on the database and ``USAGE`` on ``public`` (never on ``telemetry_store`` nor
  ``ai_read``: telemetry goes through ``public.telemetry``/``public.telemetry_hourly`` and the
  text-to-SQL path switches to ``ai_readonly``);
* ``SELECT, INSERT, UPDATE, DELETE`` on the tables and views of ``public``, except
  ``alembic_version`` (nothing), ``public.telemetry`` (``SELECT, INSERT``: the write guard
  rejects any other command anyway) and ``public.telemetry_hourly`` (``SELECT``);
* ``USAGE, SELECT`` on the sequences of ``public`` and ``EXECUTE`` on ``public.rag_search``
  (its EXECUTE was revoked from PUBLIC in 0014);
* membership in ``ai_readonly`` without inheriting its privileges (only ``SET ROLE``);
* default privileges of the migration role in ``public`` so tables and sequences created by
  later migrations are granted the same way.

Not done: ``REVOKE USAGE ON SCHEMA _timescaledb_internal FROM PUBLIC``. Chunks copy their
hypertable's grants but not its RLS, so this role can read ``sensorreading``/``deviceoperation``
chunks unfiltered by naming them. TimescaleDB 2.30.1 needs that schema for every query of a
non-owner role (``SELECT 1 FROM pg_class`` fails with "permission denied for schema
_timescaledb_internal" once it is revoked, also under ``ai_readonly``). Naming a chunk requires
arbitrary SQL, and a session that can run arbitrary SQL as this role can already set any
``app.current_user_id``: RLS protects the application from its own query bugs, not from SQL
injection. Roles that run untrusted SQL (``ai_readonly``) never receive grants on hypertables.

The role must already exist with LOGIN (``timescaledb/init/01-create-app-role.sh`` creates it on
a new volume, ``scripts/separar-roles-db.sh`` on an existing install). If it does not exist it is
created NOLOGIN so the grants have a target (tests, a role created later); the application cannot
log in until a password and LOGIN are set. The migration refuses to run when the application role
is the migration role itself or a SUPERUSER/BYPASSRLS role: RLS would be silently ineffective.

downgrade() revokes this database's grants and default privileges. The role and its
``ai_readonly`` membership are cluster-wide (other databases on the server use them) and are
kept. PostgreSQL only.
"""
import os
import re
from collections.abc import Sequence

from alembic import op

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE_ENV = "DB_APP_ROLE"
DEFAULT_APP_ROLE = "iot_app"
# Lowercase, unquoted identifier: the same rule the init script applies to DB_USER.
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]{0,62}")
RAG_SEARCH = "public.rag_search(public.vector, text, text, double precision, integer, uuid)"
TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"


def app_role() -> str:
    role = os.environ.get(APP_ROLE_ENV, "").strip() or DEFAULT_APP_ROLE
    if not IDENTIFIER.fullmatch(role):
        raise RuntimeError(f"{APP_ROLE_ENV} must be a lowercase identifier ([a-z_][a-z0-9_]*)")
    return role


def _ensure_role(role: str) -> None:
    bind = op.get_bind()
    migration_role = bind.exec_driver_sql("SELECT current_user").scalar_one()
    if role == migration_role:
        raise RuntimeError(
            f"The application role ({role}) is the migration role: set {APP_ROLE_ENV}/DB_USER to a "
            "separate login (see docs/roles-base-de-datos.md and scripts/separar-roles-db.sh)."
        )
    op.execute(f"""
        DO $role$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '{role}') THEN
                CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
                RAISE NOTICE 'role {role} did not exist: created NOLOGIN (set LOGIN and a password)';
            END IF;
        END
        $role$
    """)
    privileged = bind.exec_driver_sql(
        "SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = %(r)s", {"r": role}
    ).scalar_one()
    if privileged:
        raise RuntimeError(
            f"The application role ({role}) is SUPERUSER or BYPASSRLS, so RLS would filter nothing: "
            "run scripts/separar-roles-db.sh (see docs/roles-base-de-datos.md)."
        )


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    role = app_role()
    _ensure_role(role)

    op.execute(f"""
        DO $connect$
        BEGIN
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO {role}', current_database());
        END
        $connect$
    """)
    op.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
    op.execute(f"GRANT {TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA public TO {role}")
    op.execute(f"REVOKE ALL ON TABLE public.alembic_version FROM {role}")
    op.execute(f"REVOKE UPDATE, DELETE ON TABLE public.telemetry FROM {role}")
    op.execute(f"REVOKE INSERT, UPDATE, DELETE ON TABLE public.telemetry_hourly FROM {role}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}")
    op.execute(f"GRANT EXECUTE ON FUNCTION {RAG_SEARCH} TO {role}")
    # PostgreSQL 16: membership only to SET ROLE, without inheriting ai_readonly's column grants.
    op.execute(f"GRANT ai_readonly TO {role} WITH INHERIT FALSE, SET TRUE")

    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT {TABLE_PRIVILEGES} ON TABLES TO {role}")
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role}")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    role = app_role()
    exists = op.get_bind().exec_driver_sql(
        "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %(r)s", {"r": role}
    ).scalar()
    if not exists:
        return
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM {role}")
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE {TABLE_PRIVILEGES} ON TABLES FROM {role}")
    op.execute(f"REVOKE EXECUTE ON FUNCTION {RAG_SEARCH} FROM {role}")
    op.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}")
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {role}")
