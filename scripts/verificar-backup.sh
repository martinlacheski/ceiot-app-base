#!/usr/bin/env bash
# Verifica que un backup de scripts/backup.sh sea restaurable y completo.
#
# 1. Comprueba SHA256SUMS (ningún archivo falta, sobra ni cambió).
# 2. Arranca un contenedor descartable ceiot-backup-verify-<aleatorio> con la
#    misma imagen que el servicio postgresql (la del manifiesto si sigue
#    disponible; si no, la de docker compose config), sin red ni puertos
#    publicados, con memoria y CPU acotadas (BACKUP_VERIFY_MEMORY, por defecto
#    1g; BACKUP_VERIFY_CPUS, por defecto 1) y con los jobs de TimescaleDB
#    desactivados (ninguna política de retención o compresión toca los datos
#    durante la verificación).
# 3. Crea los roles del volcado (sin contraseñas), la base con la misma
#    codificación y locale, las extensiones en la versión del manifiesto, y
#    restaura con timescaledb_pre_restore() + pg_restore --exit-on-error +
#    timescaledb_post_restore(). Cualquier error de pg_restore invalida el
#    backup.
# 4. Recalcula el manifiesto sobre la base restaurada y exige coincidencia
#    exacta (conteos, huellas de contenido, Alembic, hypertables, políticas
#    RLS, roles, versiones de extensiones).
# 5. Comprueba los objetos S3 guardados (tamaño y sha256 contra el manifiesto,
#    el sha256 de la clave de cada documento y las referencias de la base).
#
# Escribe <backup>/verificacion.json y termina con 0 ("✅ Backup verificado")
# o 1 ("❌ Backup inválido: <motivos>"). El contenedor descartable se elimina
# siempre, también si la verificación falla o se interrumpe. No toca la base
# real ni el resto del stack.
#
# Uso:
#   scripts/verificar-backup.sh backups/<fecha>
set -euo pipefail

if [ "$#" -ne 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
  [ "$#" -eq 1 ] && exit 0 || exit 2
fi
if [ ! -d "$1" ]; then
  echo "Error: $1 no es una carpeta de backup." >&2
  exit 2
fi
backup_dir="$(cd "$1" && pwd)"

# Resource limits of the disposable container (docker run --memory / --cpus).
# Restoring a ~20 MB dump with TimescaleDB uses about 160 MB.
verify_memory="${BACKUP_VERIFY_MEMORY:-1g}"
verify_cpus="${BACKUP_VERIFY_CPUS:-1}"
if ! [[ "$verify_memory" =~ ^[1-9][0-9]*[bkmgBKMG]?$ ]]; then
  echo "Error: BACKUP_VERIFY_MEMORY debe ser un tamaño como 1g o 512m (se recibió '$verify_memory')." >&2
  exit 2
fi
if ! [[ "$verify_cpus" =~ ^[0-9]+(\.[0-9]+)?$ ]] || ! awk -v c="$verify_cpus" 'BEGIN { exit !(c > 0) }'; then
  echo "Error: BACKUP_VERIFY_CPUS debe ser un número mayor que 0, como 1 o 0.5 (se recibió '$verify_cpus')." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
helper="$(pwd)/scripts/backup_manifest.py"
command -v python3 >/dev/null || { echo "Error: hace falta python3 en el host." >&2; exit 1; }

manifest="$backup_dir/manifest.json"
field() { python3 "$helper" get "$manifest" "$1" 2>/dev/null || true; }

db_user="$(field source.user)"
image_id="$(field source.image_id)"
image_ref="$(field source.image)"
if [ -z "$db_user" ]; then
  # Without a readable manifest there is nothing to restore against; the
  # helper still checks SHA256SUMS and writes the report.
  python3 "$helper" verify --backup "$backup_dir" --setup-error "El manifiesto no indica el usuario de la base (source.user)"
  exit $?
fi

# Prefer the exact image the backup was taken with; fall back to the image the
# compose file names today (the manifest comparison then reports any change in
# the PostgreSQL or extension versions).
image=""
if [ -n "$image_id" ] && docker image inspect "$image_id" >/dev/null 2>&1; then
  image="$image_id"
else
  image="$(docker compose config --format json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["postgresql"]["image"])' 2>/dev/null || true)"
  image="${image:-$image_ref}"
fi

container="ceiot-backup-verify-$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "Verificando $backup_dir en el contenedor descartable $container ($image)..."
setup_error=""
# No network at all: trust authentication is only reachable through the
# container's own unix socket. NO_TS_TUNE keeps the default memory settings.
if ! docker run -d --name "$container" --network none --label ceiot.backup-verify=1 \
  --memory "$verify_memory" --cpus "$verify_cpus" \
  -e POSTGRES_USER="$db_user" -e POSTGRES_DB=postgres -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e NO_TS_TUNE=true -e TIMESCALEDB_TELEMETRY=off \
  "$image" postgres -c timescaledb.max_background_workers=0 >/dev/null; then
  setup_error="No se pudo arrancar el contenedor descartable con la imagen $image"
else
  # The image's init runs a temporary server on the unix socket only; the
  # final one also listens on TCP, so readiness is checked on 127.0.0.1.
  ready=false
  for _ in $(seq 1 120); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" != "true" ]; then
      break
    fi
    if docker exec "$container" pg_isready -q -h 127.0.0.1 -U "$db_user" -d postgres >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [ "$ready" = false ]; then
    setup_error="El contenedor descartable no quedó listo: $(docker logs --tail 3 "$container" 2>&1 | tr '\n' ' ')"
  fi
fi

set +e
if [ -n "$setup_error" ]; then
  python3 "$helper" verify --backup "$backup_dir" --setup-error "$setup_error"
else
  python3 "$helper" verify --backup "$backup_dir" --container "$container"
fi
status=$?
set -e
exit "$status"
