#!/usr/bin/env bash
# Separa los roles de la base en una instalación existente: el superusuario de
# migraciones (ALEMBIC_DB_USER, p. ej. iot_app_admin) y el usuario de la
# aplicación (DB_USER, p. ej. iot_app) sin SUPERUSER ni BYPASSRLS, para que
# Row Level Security filtre de verdad las consultas de la API y de mqtt-runtime.
# Ver docs/roles-base-de-datos.md.
#
# Hasta ahora el contenedor se inicializaba con POSTGRES_USER=DB_USER, así que
# DB_USER es el superusuario de arranque del clúster (OID 10): es dueño de los
# catálogos del sistema, de la base, de las tablas y de los trabajos de
# TimescaleDB, y PostgreSQL no permite quitarle SUPERUSER ni reasignar sus
# objetos. Por eso el script no reasigna nada: RENOMBRA ese rol a
# ALEMBIC_DB_USER (todo lo que poseía pasa a ser del administrador, también los
# trabajos de TimescaleDB, que se guardan por OID) y crea DB_USER como un rol
# nuevo sin privilegios, con la misma contraseña DB_PASSWORD (backend y
# mqtt-runtime no cambian de credenciales).
#
# Pasos:
# 1. Lee timescaledb/.env (DB_USER, DB_PASSWORD, ALEMBIC_DB_USER,
#    ALEMBIC_DB_PASSWORD, DB_DATABASE); nunca imprime sus valores.
# 2. Detecta el estado (sin cambios): ya separado, sin separar, o desconocido
#    (en ese caso no toca nada).
# 3. Exige un backup verificado de las últimas 24 h; si no hay, ejecuta
#    scripts/backup.sh (con verificación) y se detiene si falla. --sin-backup
#    omite este paso.
# 4. Detiene backend, mqtt-runtime y pgAdmin.
# 5. En una transacción (con un superusuario temporal, conectado por el socket
#    local del contenedor): renombra DB_USER a ALEMBIC_DB_USER con la
#    contraseña ALEMBIC_DB_PASSWORD y crea DB_USER con DB_PASSWORD, LOGIN,
#    NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE. Luego borra el rol
#    temporal.
# 6. Reconstruye las imágenes del backend y mqtt-runtime y ejecuta
#    scripts/levantar.sh: recrea PostgreSQL con el nuevo POSTGRES_USER, aplica
#    `alembic upgrade head` como administrador (la migración 0029 otorga los
#    permisos del usuario de la aplicación) y levanta el resto del stack.
# 7. Comprueba el resultado: atributos de los roles, versión de Alembic, dueño
#    de los trabajos de TimescaleDB y que RLS filtra para DB_USER.
#
# Es idempotente: si los roles ya están separados solo reasegura los atributos
# y la contraseña de DB_USER y vuelve a levantar el stack.
#
# Uso:
#   scripts/separar-roles-db.sh              # separar (con backup previo)
#   scripts/separar-roles-db.sh --dry-run    # mostrar estado y plan, sin cambios
#   scripts/separar-roles-db.sh --sin-backup # no exigir backup (no recomendado)
#
# Códigos de salida: 0 listo, 1 error, 2 uso incorrecto o configuración
# incompleta.
set -euo pipefail

export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:/snap/bin"

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

dry_run=false
with_backup=true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --sin-backup) with_backup=false ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

env_file="timescaledb/.env"
transition_role="ceiot_transicion_roles"
backup_max_age_hours=24

if [ ! -f "$env_file" ]; then
  echo "Error: falta $env_file." >&2
  exit 2
fi

# Reads one KEY=value from the env file (compose syntax: optional quotes and
# `export`). Values stay in shell variables and are never printed.
env_value() {
  python3 - "$env_file" "$1" <<'PY'
import re, sys
path, key = sys.argv[1], sys.argv[2]
value = ""
for line in open(path, encoding="utf-8"):
    match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
    if not match or match.group(1) != key:
        continue
    raw = match.group(2)
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        raw = raw[1:-1]
    else:
        raw = re.sub(r"\s+#.*$", "", raw)
    value = raw
sys.stdout.write(value)
PY
}

app_user="$(env_value DB_USER)"
app_password="$(env_value DB_PASSWORD)"
admin_user="$(env_value ALEMBIC_DB_USER)"
admin_password="$(env_value ALEMBIC_DB_PASSWORD)"
db_name="$(env_value DB_DATABASE)"

missing=()
for name in DB_USER DB_PASSWORD ALEMBIC_DB_USER ALEMBIC_DB_PASSWORD DB_DATABASE; do
  case "$name" in
    DB_USER) value="$app_user" ;;
    DB_PASSWORD) value="$app_password" ;;
    ALEMBIC_DB_USER) value="$admin_user" ;;
    ALEMBIC_DB_PASSWORD) value="$admin_password" ;;
    DB_DATABASE) value="$db_name" ;;
  esac
  [ -n "$value" ] || missing+=("$name")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Error: $env_file no define ${missing[*]} (ver timescaledb/.env.example y docs/roles-base-de-datos.md)." >&2
  exit 2
fi
for name in "$app_user" "$admin_user"; do
  if ! [[ "$name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
    echo "Error: DB_USER y ALEMBIC_DB_USER deben ser identificadores en minúsculas (letras, números y _)." >&2
    exit 2
  fi
done
if ! [[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "Error: DB_DATABASE debe ser un identificador simple (letras, números y _)." >&2
  exit 2
fi
# Compose expands "$" and escapes in .env values; restricting passwords to
# letters and digits guarantees the role gets exactly what the backend sends.
for password in "$app_password" "$admin_password"; do
  if ! [[ "$password" =~ ^[A-Za-z0-9]+$ ]]; then
    echo "Error: DB_PASSWORD y ALEMBIC_DB_PASSWORD deben tener solo letras y números (genérelas con: openssl rand -hex 24)." >&2
    exit 2
  fi
done
if [ "$app_user" = "$admin_user" ]; then
  echo "Error: DB_USER y ALEMBIC_DB_USER deben ser usuarios distintos." >&2
  exit 2
fi
if [ "$app_password" = "$admin_password" ]; then
  echo "Error: DB_PASSWORD y ALEMBIC_DB_PASSWORD deben ser distintas." >&2
  exit 2
fi

pg_container="$(docker compose ps -q --status running postgresql 2>/dev/null || true)"
if [ -z "$pg_container" ]; then
  echo "Error: el servicio postgresql no está corriendo (docker compose up -d --wait postgresql)." >&2
  exit 1
fi

# psql over the container's local socket (trust authentication inside the
# container), reading SQL from stdin.
psql_as() {
  docker exec -i "$pg_container" psql -X -q -At -v ON_ERROR_STOP=1 -U "$1" -d "$2"
}
sql_literal() { printf "'%s'" "${1//\'/\'\'}"; }

connect_user=""
for candidate in "$app_user" "$admin_user"; do
  if echo "SELECT 1" | psql_as "$candidate" postgres >/dev/null 2>&1; then
    connect_user="$candidate"
    break
  fi
done
if [ -z "$connect_user" ]; then
  echo "Error: no se pudo conectar a PostgreSQL como $app_user ni como $admin_user." >&2
  exit 1
fi

state_line="$(psql_as "$connect_user" postgres <<SQL
SELECT concat_ws('|',
  (SELECT rolname FROM pg_roles WHERE oid = 10),
  COALESCE((SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'privileged' ELSE 'plain' END
            FROM pg_roles WHERE rolname = '$app_user'), 'missing'),
  COALESCE((SELECT CASE WHEN rolsuper THEN 'super' ELSE 'plain' END
            FROM pg_roles WHERE rolname = '$admin_user'), 'missing'),
  (SELECT count(*) FROM pg_database WHERE datname = '$db_name'));
SQL
)"
IFS='|' read -r bootstrap_user app_state admin_state db_exists <<<"$state_line"

if [ "$db_exists" != "1" ]; then
  echo "Error: la base $db_name (DB_DATABASE) no existe en el servidor." >&2
  exit 1
fi

if [ "$bootstrap_user" = "$app_user" ] && [ "$admin_state" = "missing" ]; then
  state="sin-separar"
  echo "Estado: sin separar ($app_user es el superusuario de arranque y dueño de todo)."
elif [ "$bootstrap_user" = "$admin_user" ] && [ "$app_state" != "privileged" ]; then
  state="separado"
  case "$app_state" in
    missing) app_note="falta, se crea" ;;
    *) app_note="sin privilegios" ;;
  esac
  echo "Estado: ya separado ($admin_user es el superusuario; $app_user: $app_note)."
else
  echo "Error: estado no reconocido (superusuario de arranque: $bootstrap_user; $app_user: $app_state; $admin_user: $admin_state)." >&2
  echo "El script solo convierte una instalación donde DB_USER es el superusuario de arranque y ALEMBIC_DB_USER todavía no existe. No se modificó nada; ver docs/roles-base-de-datos.md." >&2
  exit 1
fi

latest_verified_backup() {
  python3 - "${BACKUP_DIR:-backups}" "$backup_max_age_hours" <<'PY'
import datetime, json, os, re, sys
root, hours = sys.argv[1], int(sys.argv[2])
now = datetime.datetime.now(datetime.timezone.utc)
best = None
if os.path.isdir(root):
    for name in os.listdir(root):
        if not re.fullmatch(r"\d{8}T\d{6}Z", name):
            continue
        try:
            with open(os.path.join(root, name, "verificacion.json"), encoding="utf-8") as handle:
                ok = json.load(handle).get("ok") is True
        except (OSError, ValueError):
            continue
        taken = datetime.datetime.strptime(name, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        if ok and now - taken <= datetime.timedelta(hours=hours) and (best is None or name > best):
            best = name
print(best or "")
PY
}

backup_name="$(latest_verified_backup)"
if [ "$dry_run" = true ]; then
  echo "Plan (--dry-run, no se cambia nada):"
  if [ "$with_backup" = false ]; then
    echo "  - sin backup previo (--sin-backup)"
  elif [ -n "$backup_name" ]; then
    echo "  - backup verificado reciente: backups/$backup_name"
  else
    echo "  - ejecutar scripts/backup.sh (no hay backup verificado de las últimas ${backup_max_age_hours} h)"
  fi
  echo "  - detener backend, mqtt-runtime y pgadmin"
  if [ "$state" = "sin-separar" ]; then
    echo "  - renombrar $app_user a $admin_user (contraseña ALEMBIC_DB_PASSWORD)"
    echo "  - crear $app_user sin SUPERUSER ni BYPASSRLS (contraseña DB_PASSWORD)"
  else
    echo "  - reasegurar atributos y contraseña de $app_user"
  fi
  echo "  - docker compose build backend mqtt-runtime y scripts/levantar.sh (alembic upgrade head como $admin_user)"
  exit 0
fi

if [ "$with_backup" = true ]; then
  if [ -n "$backup_name" ]; then
    echo "Backup verificado reciente: backups/$backup_name"
  else
    echo "No hay un backup verificado de las últimas ${backup_max_age_hours} h: ejecutando scripts/backup.sh..."
    if ! scripts/backup.sh; then
      echo "Error: el backup falló; no se modificó nada." >&2
      exit 1
    fi
  fi
else
  echo "Aviso: sin backup previo (--sin-backup)." >&2
fi

echo "Deteniendo backend, mqtt-runtime y pgadmin..."
docker compose stop backend mqtt-runtime pgadmin >/dev/null 2>&1 || true

app_literal="$(sql_literal "$app_password")"
admin_literal="$(sql_literal "$admin_password")"

if [ "$state" = "sin-separar" ]; then
  echo "Creando el superusuario temporal $transition_role..."
  psql_as "$app_user" postgres <<SQL
DROP ROLE IF EXISTS $transition_role;
CREATE ROLE $transition_role SUPERUSER LOGIN;
SQL
  echo "Renombrando $app_user a $admin_user y creando $app_user sin privilegios..."
  # Passwords travel through stdin only; statement logging (also on error) is off for this session.
  psql_as "$transition_role" postgres >/dev/null <<SQL
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
WHERE usename = '$app_user' AND backend_type = 'client backend' AND pid <> pg_backend_pid();
BEGIN;
ALTER ROLE "$app_user" RENAME TO "$admin_user";
ALTER ROLE "$admin_user" WITH LOGIN SUPERUSER PASSWORD $admin_literal;
CREATE ROLE "$app_user" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD $app_literal;
GRANT CONNECT ON DATABASE "$db_name" TO "$app_user";
COMMIT;
SQL
  psql_as "$admin_user" postgres <<SQL >/dev/null
DROP ROLE $transition_role;
SQL
else
  echo "Reasegurando atributos y contraseña de $app_user..."
  psql_as "$admin_user" postgres <<SQL
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
DROP ROLE IF EXISTS $transition_role;
SELECT format('CREATE ROLE %I', '$app_user') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$app_user') \gexec
ALTER ROLE "$app_user" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD $app_literal;
GRANT CONNECT ON DATABASE "$db_name" TO "$app_user";
SQL
fi

# From here on the roles are already separated: a failure only needs a re-run.
trap 'echo "Error: los roles ya quedaron separados, pero falló la reconstrucción o las migraciones. Corrija el problema y vuelva a ejecutar scripts/separar-roles-db.sh para terminar (es idempotente)." >&2' ERR
echo "Reconstruyendo las imágenes del backend y aplicando las migraciones (scripts/levantar.sh)..."
docker compose build backend mqtt-runtime
scripts/levantar.sh

pg_container="$(docker compose ps -q --status running postgresql)"
echo "Comprobando..."
check="$(psql_as "$admin_user" "$db_name" <<SQL
SELECT concat_ws('|',
  (SELECT rolname FROM pg_roles WHERE oid = 10),
  (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = '$app_user'),
  (SELECT version_num FROM alembic_version),
  (SELECT count(*) FROM timescaledb_information.jobs WHERE owner::text <> '$admin_user'),
  (SELECT pg_has_role('$app_user', 'ai_readonly', 'MEMBER')),
  (SELECT count(*) FROM public.device));
SET ROLE "$app_user";
SELECT set_config('app.current_user_id', '', false);
SELECT count(*) FROM public.device;
SQL
)"
IFS='|' read -r final_bootstrap app_privileged alembic_version foreign_jobs ai_member admin_devices <<<"$(printf '%s\n' "$check" | sed -n 1p)"
app_devices="$(printf '%s\n' "$check" | sed -n '$p')"

problems=()
[ "$final_bootstrap" = "$admin_user" ] || problems+=("el superusuario de arranque es $final_bootstrap")
[ "$app_privileged" = "f" ] || problems+=("$app_user sigue con SUPERUSER o BYPASSRLS")
[ "$foreign_jobs" = "0" ] || problems+=("$foreign_jobs trabajo(s) de TimescaleDB no pertenecen a $admin_user")
[ "$ai_member" = "t" ] || problems+=("$app_user no es miembro de ai_readonly")
[ "$app_devices" = "0" ] || problems+=("$app_user ve $app_devices dispositivo(s) sin identidad: RLS no filtra")

echo "  superusuario (migraciones, trabajos, backups): $final_bootstrap"
echo "  usuario de la aplicación: $app_user (SUPERUSER/BYPASSRLS: $app_privileged)"
echo "  versión de Alembic: $alembic_version"
echo "  dispositivos visibles: $admin_devices como $admin_user, $app_devices como $app_user sin identidad"
if [ "${#problems[@]}" -gt 0 ]; then
  printf '❌ %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "✅ Roles separados: la API y mqtt-runtime se conectan como $app_user y RLS filtra sus consultas."
echo "pgAdmin guarda el servidor con el usuario anterior: para recrearlo con $admin_user, ejecute"
project="$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' 2>/dev/null || echo iot-app-base)"
echo "  docker compose rm -sf pgadmin && docker volume rm ${project}_pgadmin-data && scripts/levantar.sh"
echo "(o cambie el usuario del servidor en pgAdmin). Ver docs/roles-base-de-datos.md."
