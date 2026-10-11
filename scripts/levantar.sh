#!/usr/bin/env bash
# Levanta el stack de desarrollo completo (también en un clon nuevo).
#
# - Verifica antes de arrancar: versión de Docker Compose, archivos .env de
#   cada componente (nunca los crea ni los copia) y certificados del broker.
# - Crea las carpetas de datos montadas (mqtt/data, mqtt/log, redis/data,
#   seaweedfs/data) y avisa si las de EMQX no pertenecen al uid 1000.
# - Aplica las migraciones de Alembic antes de levantar el resto: arranca
#   PostgreSQL, espera a que esté sano y ejecuta `alembic upgrade head` en un
#   contenedor descartable del backend. En una base vacía crea el esquema y los
#   catálogos iniciales (tipo de dispositivo "Ambiental", sensores y
#   variables); si ya está al día, no hace nada.
# - Siempre arranca el backend y mqtt-runtime con MAIL_TRANSPORT=mailpit
#   (nunca envía mails reales desde desarrollo) y activa el perfil local-mail
#   para que Mailpit capture esos correos.
# - pgAdmin y RedisInsight arrancan junto con el resto.
# - El contenedor de embeddings locales solo existe si backend/.env tiene
#   EMBEDDING_PROVIDER=local; si no, se elimina para no dejarlo detenido.
#
# El nombre del proyecto es el de docker-compose.yml (iot-app-base), salvo que
# se defina COMPOSE_PROJECT_NAME.
#
# Uso:
#   scripts/levantar.sh            # levantar
#   scripts/levantar.sh --build    # reconstruir las imágenes y levantar
#   scripts/levantar.sh --dry-run  # mostrar los comandos sin ejecutarlos
set -euo pipefail

cd "$(dirname "$0")/.."

build=""
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --build) build="--build" ;;
    --dry-run) dry_run=true ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

run() {
  echo "+ $*"
  if [ "$dry_run" = false ]; then "$@"; fi
}

# The root compose file relies on `include` with per-file env_file lists and
# on `env_file: {path, required: false}`, both available from Compose 2.24.
min_compose="2.24.0"
compose_version="$(docker compose version --short 2>/dev/null || true)"
compose_version="${compose_version#v}"
if [ -z "$compose_version" ]; then
  echo "Error: no se encontró Docker Compose v2 (docker compose). Instalá Docker con el plugin Compose $min_compose o superior." >&2
  exit 1
fi
if [ "$(printf '%s\n%s\n' "$min_compose" "$compose_version" | sort -V | head -n 1)" != "$min_compose" ]; then
  echo "Error: Docker Compose $compose_version es anterior a $min_compose (requerido por docker-compose.yml)." >&2
  exit 1
fi

# Every component keeps its own .env; they are never created automatically
# because they hold secrets the operator must choose.
missing_env=()
for component in backend frontend landing timescaledb mqtt; do
  if [ ! -f "$component/.env" ]; then missing_env+=("$component"); fi
done
if [ "${#missing_env[@]}" -gt 0 ]; then
  echo "Error: faltan archivos de configuración. Crealos a partir de las plantillas y completá los valores (ver README.md, sección \"Arranque\"):" >&2
  for component in "${missing_env[@]}"; do
    echo "  cp $component/.env.example $component/.env" >&2
  done
  exit 1
fi

# The templates mark every value the operator must choose with CAMBIAR_ (only
# file names are printed, never values).
for env_file in backend/.env frontend/.env landing/.env timescaledb/.env mqtt/.env seaweedfs/.env pgadmin/.env; do
  if [ -f "$env_file" ] && grep -q 'CAMBIAR_' "$env_file"; then
    echo "Aviso: $env_file todavía tiene valores de ejemplo (CAMBIAR_...). Reemplazalos antes de usar el stack fuera de tu máquina." >&2
  fi
done

if [ ! -f seaweedfs/.env ]; then
  echo "Aviso: falta seaweedfs/.env (S3_ACCESS_KEY y S3_SECRET_KEY); el módulo Documentos responderá 503. Para activarlo: cp seaweedfs/.env.example seaweedfs/.env" >&2
fi
if [ ! -f pgadmin/.env ]; then
  echo "Aviso: falta pgadmin/.env (PGADMIN_DEFAULT_EMAIL y PGADMIN_DEFAULT_PASSWORD); pgAdmin solo arranca si ya se inicializó antes. Para activarlo: cp pgadmin/.env.example pgadmin/.env" >&2
fi

# Without an administrator in the database the backend creates the first one
# from these variables and refuses to start if they are empty. Only the
# presence of a value is checked; values are never printed.
missing_bootstrap=()
for var in BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD; do
  if ! grep -qE "^[[:space:]]*$var=[^[:space:]]" backend/.env; then
    missing_bootstrap+=("$var")
  fi
done
if [ "${#missing_bootstrap[@]}" -gt 0 ]; then
  echo "Aviso: backend/.env no define ${missing_bootstrap[*]}. Solo hace falta en una base sin administrador (primer arranque); sin ellas el backend no arranca en ese caso." >&2
fi

# Read only the provider name from backend/.env (never print other values).
provider="openrouter"
value="$(grep -E '^[[:space:]]*EMBEDDING_PROVIDER=' backend/.env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r" || true)"
if [ -n "$value" ]; then provider="$value"; fi
echo "Proveedor de embeddings: $provider"

# Without the broker certificates Docker would create mqtt/certs/ owned by root
# and EMQX would start without its mTLS listener.
certs_dir="${MQTT_CERTS_DIR:-mqtt/certs}"
for cert in ca.crt emqx.crt emqx.key; do
  if [ ! -f "$certs_dir/$cert" ]; then
    echo "Error: falta $certs_dir/$cert. Generá los certificados del broker antes de levantar el stack (ver docs/certificados-mqtt.md)." >&2
    exit 1
  fi
done

# Bind-mounted data folders. Created here (owned by the current user) so
# Docker does not create them as root on the first start.
run mkdir -p mqtt/data mqtt/log redis/data seaweedfs/data

# EMQX runs as uid 1000 inside its container and must be able to write its
# database (mqtt/data) and logs (mqtt/log). Redis adjusts its own folder.
emqx_uid=1000
for dir in mqtt/data mqtt/log; do
  if [ -d "$dir" ] && [ "$(stat -c '%u' "$dir")" != "$emqx_uid" ]; then
    echo "Aviso: $dir no pertenece al uid $emqx_uid (usuario de EMQX en el contenedor); EMQX podría no poder escribir ahí. Corregilo con: sudo chown -R $emqx_uid:$emqx_uid mqtt/data mqtt/log" >&2
  fi
done
# The broker key is created 0600 by the PKI scripts: EMQX can only read it when
# it belongs to the same uid.
broker_key="${MQTT_CERTS_DIR:-mqtt/certs}/emqx.key"
if [ -f "$broker_key" ] && [ "$(stat -c '%u' "$broker_key")" != "$emqx_uid" ]; then
  echo "Aviso: $broker_key no pertenece al uid $emqx_uid; EMQX no podrá leerla y el listener TLS no arrancará. Corregilo con: sudo chown $emqx_uid:$emqx_uid $broker_key" >&2
fi

export MAIL_TRANSPORT=mailpit

# Database first: start PostgreSQL, wait until it is healthy and apply the
# Alembic migrations in a one-off backend container (no published ports, no
# other services), so the backend never starts against an outdated schema.
run docker compose up -d --wait postgresql
if [ -n "$build" ]; then
  run docker compose build backend
fi
run docker compose run --rm --no-deps backend alembic upgrade head

if [ "$provider" = "local" ]; then
  run docker compose --profile local-mail --profile embeddings-local up -d $build
else
  run docker compose --profile local-mail up -d $build
  # Remove the stopped local-embeddings container so it doesn't linger.
  run docker compose --profile embeddings-local rm -sf embeddings
fi
