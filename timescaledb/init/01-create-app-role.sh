#!/bin/bash
# Runs only on the FIRST start of an empty data volume (docker-entrypoint-initdb.d).
#
# Creates the application login (DB_USER / DB_PASSWORD from timescaledb/.env) used by the
# backend and mqtt-runtime. It is deliberately unprivileged: no SUPERUSER and no BYPASSRLS
# (otherwise Row Level Security would filter nothing), no CREATEDB, no CREATEROLE. The image's
# superuser (POSTGRES_USER = ALEMBIC_DB_USER) owns every object and runs the migrations; the
# table, sequence and function grants for this role are applied by the Alembic migration 0029,
# so they also follow later migrations. See docs/roles-base-de-datos.md.
#
# Existing volumes are never touched by this script: use scripts/separar-roles-db.sh.
set -euo pipefail

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"
app_user="${DB_USER:-}"
app_password="${DB_PASSWORD:-}"

if [ -z "$app_user" ] || [ -z "$app_password" ]; then
  echo "01-create-app-role: DB_USER y DB_PASSWORD son obligatorios (timescaledb/.env)." >&2
  exit 1
fi
# Same rule as the migration: a plain lowercase identifier (it is also used unquoted in URLs).
if ! [[ "$app_user" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "01-create-app-role: DB_USER debe ser un identificador en minúsculas (letras, números y _)." >&2
  exit 1
fi
if [ "$app_user" = "$POSTGRES_USER" ]; then
  echo "01-create-app-role: DB_USER no puede ser el mismo usuario que ALEMBIC_DB_USER (superusuario de migraciones)." >&2
  exit 1
fi

# The values reach psql through its environment (\getenv) and are quoted by format(): the
# password is never interpolated into SQL by the shell nor visible in the process list.
export CEIOT_APP_USER="$app_user" CEIOT_APP_PASSWORD="$app_password"
psql -v ON_ERROR_STOP=1 -X -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
\getenv app_user CEIOT_APP_USER
\getenv app_password CEIOT_APP_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
              :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
EOSQL

echo "01-create-app-role: usuario de aplicación '$app_user' creado (sin SUPERUSER ni BYPASSRLS)."
