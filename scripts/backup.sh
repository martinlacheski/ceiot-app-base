#!/usr/bin/env bash
# Genera un backup consistente del stack y lo verifica restaurándolo en una
# base descartable.
#
# - Base de datos: abre una transacción REPEATABLE READ en el contenedor
#   postgresql, exporta su snapshot (pg_export_snapshot) y, mientras sigue
#   abierta, ejecuta pg_dump -Fc --snapshot y calcula el manifiesto (conteos
#   exactos, huellas de contenido, hypertables, políticas RLS, roles, versión
#   de Alembic y de las extensiones) sobre ese mismo snapshot. Dump y
#   manifiesto describen exactamente el mismo estado.
# - Roles: pg_dumpall --roles-only --no-role-passwords (sin contraseñas).
# - Objetos S3 (documentos y firmware en SeaweedFS): se descargan por la API S3
#   desde el contenedor del backend (las credenciales nunca salen de él) y se
#   registran con tamaño y sha256. Sin S3 configurado se registra "skipped".
# - SHA256SUMS con el checksum de cada archivo del backup.
# - Al final ejecuta scripts/verificar-backup.sh (salvo --sin-verificar).
#
# Solo lee la base real: no la modifica. El resultado queda en
# backups/<fecha UTC>/ (ignorado por git, permisos 700).
#
# El nombre del proyecto es el de docker-compose.yml (iot-app-base), salvo que
# se defina COMPOSE_PROJECT_NAME.
#
# Uso:
#   scripts/backup.sh                    # backup + verificación
#   scripts/backup.sh --sin-verificar    # solo el backup
#   scripts/backup.sh --sin-s3           # excluir a propósito los objetos S3
#   scripts/backup.sh --destino DIR      # carpeta raíz (por defecto backups/)
set -euo pipefail

cd "$(dirname "$0")/.."
repo_root="$(pwd)"
helper="$repo_root/scripts/backup_manifest.py"

verify=true
with_s3=true
dest_root="backups"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sin-verificar) verify=false ;;
    --sin-s3) with_s3=false ;;
    --destino)
      [ "$#" -ge 2 ] || { echo "Error: --destino necesita una carpeta." >&2; exit 2; }
      dest_root="$2"; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v python3 >/dev/null || { echo "Error: hace falta python3 en el host." >&2; exit 1; }

started_at=$(date +%s)
# Backups hold application data (password hashes included): owner-only.
umask 077

pg_container="$(docker compose ps -q --status running postgresql 2>/dev/null || true)"
if [ -z "$pg_container" ]; then
  echo "Error: el servicio postgresql no está corriendo. Levantá el stack con scripts/levantar.sh." >&2
  exit 1
fi
# Same credentials the container was initialised with (never the password).
db_user="$(docker exec "$pg_container" printenv POSTGRES_USER)"
db_name="$(docker exec "$pg_container" printenv POSTGRES_DB)"
compose_json="$(docker compose config --format json)"
compose_project="$(printf '%s' "$compose_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
pg_image="$(printf '%s' "$compose_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["postgresql"]["image"])')"
pg_image_id="$(docker inspect -f '{{.Image}}' "$pg_container")"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest_root"
final_dir="$dest_root/$timestamp"
work_dir="$dest_root/$timestamp.incompleto"
if [ -e "$final_dir" ] || [ -e "$work_dir" ]; then
  echo "Error: $final_dir ya existe." >&2
  exit 1
fi
mkdir -p "$work_dir"
parts="$(mktemp -d)"

snapshot_open=false
completed=false
cleanup() {
  if [ "$snapshot_open" = true ] && [ -n "${SNAP_PID:-}" ]; then
    kill "$SNAP_PID" 2>/dev/null || true
  fi
  rm -rf "$parts"
  if [ "$completed" = false ]; then
    rm -rf "$work_dir"
    echo "❌ Backup incompleto: no se generó $final_dir." >&2
  fi
}
trap cleanup EXIT

echo "Proyecto: $compose_project — base $db_name (imagen $pg_image)"
echo "Destino: $final_dir"

# 1. Snapshot: this session keeps the transaction open until the dump and the
#    manifest are done; both import its snapshot.
coproc SNAP { docker exec -i "$pg_container" psql -X -q -At -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" 2>&1; }
snapshot_open=true
printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SELECT pg_export_snapshot();" >&"${SNAP[1]}"
snapshot=""
if ! IFS= read -r -t 30 snapshot <&"${SNAP[0]}" || ! [[ "$snapshot" =~ ^[0-9A-Fa-f]+(-[0-9A-Fa-f]+)+$ ]]; then
  echo "Error: no se pudo exportar el snapshot de PostgreSQL: ${snapshot:-sin respuesta}" >&2
  exit 1
fi
echo "Snapshot exportado: $snapshot"

echo "Volcando la base (pg_dump -Fc)..."
docker exec "$pg_container" pg_dump -U "$db_user" -d "$db_name" --snapshot="$snapshot" -Fc \
  >"$work_dir/db.dump" 2>"$work_dir/pg_dump.log"

echo "Calculando el manifiesto sobre el mismo snapshot..."
python3 "$helper" database --container "$pg_container" --user "$db_user" --db "$db_name" \
  --snapshot "$snapshot" --out "$parts/database.json"

printf '%s\n' "COMMIT;" '\q' >&"${SNAP[1]}"
wait "$SNAP_PID" 2>/dev/null || true
snapshot_open=false

echo "Volcando los roles (sin contraseñas)..."
docker exec "$pg_container" pg_dumpall -U "$db_user" --roles-only --no-role-passwords >"$work_dir/roles.sql"

# 2. S3 objects, copied after the snapshot: an object deleted in between would
#    show up as missing in the verification (see docs/backups.md).
if [ "$with_s3" = true ]; then
  echo "Copiando los objetos S3 (documentos y firmware)..."
  if [ -n "$(docker compose ps -q --status running backend 2>/dev/null || true)" ]; then
    s3_cmd=(docker compose exec -T backend python -)
  else
    s3_cmd=(docker compose run --rm --no-deps -T backend python -)
  fi
  set +e
  python3 "$helper" s3-exporter | "${s3_cmd[@]}" >"$parts/s3.tar" 2>"$parts/s3.err"
  s3_exit=${PIPESTATUS[1]}
  set -e
  mkdir -p "$work_dir/s3/objects"
  python3 "$helper" s3-extract --tar "$parts/s3.tar" --dest "$work_dir/s3/objects" \
    --exit-code "$s3_exit" --stderr "$parts/s3.err" --out "$parts/s3.json"
  rmdir "$work_dir/s3/objects" "$work_dir/s3" 2>/dev/null || true
else
  echo "Objetos S3 excluidos (--sin-s3)."
  printf '{"status": "excluded", "reason": "excluido con --sin-s3"}\n' >"$parts/s3.json"
fi
s3_status="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["status"] + (" (" + d["reason"] + ")" if d.get("reason") else ""))' "$parts/s3.json")"
echo "S3: $s3_status"

# 3. Manifest and checksums.
python3 - "$parts/meta.json" "$compose_project" "$pg_image" "$pg_image_id" "$db_user" "$db_name" "$snapshot" <<'PY'
import datetime, json, sys
out, project, image, image_id, user, database, snapshot = sys.argv[1:]
meta = {
    "created_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "tool": "scripts/backup.sh",
    "source": {
        "compose_project": project,
        "image": image,
        "image_id": image_id,
        "user": user,
        "database": database,
        "snapshot": snapshot,
    },
}
with open(out, "w", encoding="utf-8") as handle:
    json.dump(meta, handle, indent=2)
PY
python3 "$helper" assemble --meta "$parts/meta.json" --database "$parts/database.json" \
  --s3 "$parts/s3.json" --out "$work_dir/manifest.json"
python3 "$helper" sums write "$work_dir"

mv "$work_dir" "$final_dir"
completed=true
elapsed=$(( $(date +%s) - started_at ))
echo "Backup generado en $final_dir ($(du -sh "$final_dir" | cut -f1), ${elapsed}s)."

if [ "$verify" = true ]; then
  echo
  "$repo_root/scripts/verificar-backup.sh" "$final_dir" && exit 0 || exit $?
fi
echo "Verificalo con: scripts/verificar-backup.sh $final_dir"
