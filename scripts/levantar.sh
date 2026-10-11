#!/usr/bin/env bash
# Levanta el stack de desarrollo completo.
#
# - Siempre arranca el backend y mqtt-runtime con MAIL_TRANSPORT=mailpit
#   (nunca envía mails reales desde desarrollo).
# - pgAdmin y RedisInsight arrancan junto con el resto.
# - El contenedor de embeddings locales solo existe si backend/.env tiene
#   EMBEDDING_PROVIDER=local; si no, se elimina para no dejarlo detenido.
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

# Read only the provider name from backend/.env (never print other values).
provider="openrouter"
if [ -f backend/.env ]; then
  value="$(grep -E '^[[:space:]]*EMBEDDING_PROVIDER=' backend/.env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r")"
  if [ -n "$value" ]; then provider="$value"; fi
fi
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

if [ ! -f pgadmin/.env ]; then
  echo "Aviso: falta pgadmin/.env (PGADMIN_DEFAULT_EMAIL y PGADMIN_DEFAULT_PASSWORD); pgAdmin solo arranca si ya se inicializó antes." >&2
fi

export MAIL_TRANSPORT=mailpit

if [ "$provider" = "local" ]; then
  run docker compose --profile embeddings-local up -d $build
else
  run docker compose up -d $build
  # Remove the stopped local-embeddings container so it doesn't linger.
  run docker compose --profile embeddings-local rm -sf embeddings
fi
