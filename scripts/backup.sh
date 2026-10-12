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
# Retención: después de un backup VERIFICADO borra los backups viejos de la
# carpeta destino y conserva los N verificados más recientes (--conservar N,
# por defecto 7 o la variable BACKUP_KEEP; 0 desactiva la retención). De los
# backups no verificados (verificación fallida, sin verificar o .incompleto)
# conserva sólo el más reciente, para poder inspeccionarlo. Sólo considera
# carpetas con nombre <fecha UTC> o <fecha UTC>.incompleto; nunca toca otras.
# Si la verificación falla, o con --sin-verificar, no se borra nada.
#
# Una sola ejecución a la vez por carpeta destino (flock sobre <destino>/.lock):
# si ya hay otra en curso, termina con código 75 sin hacer nada.
#
# El nombre del proyecto es el de docker-compose.yml (iot-app-base), salvo que
# se defina COMPOSE_PROJECT_NAME. Funciona desde cron (no necesita terminal y
# completa el PATH mínimo de cron).
#
# Uso:
#   scripts/backup.sh                    # backup + verificación + retención
#   scripts/backup.sh --sin-verificar    # solo el backup (sin retención)
#   scripts/backup.sh --sin-s3           # excluir a propósito los objetos S3
#   scripts/backup.sh --destino DIR      # carpeta raíz (por defecto backups/)
#   scripts/backup.sh --conservar N      # backups verificados a conservar
#   scripts/backup.sh --solo-retencion   # aplicar la retención sin backup
#
# Códigos de salida: 0 backup verificado (o generado, con --sin-verificar),
# 1 backup inválido o error, 2 uso incorrecto, 75 otra ejecución en curso.
set -euo pipefail

# cron runs with a minimal PATH (/usr/bin:/bin); docker may live elsewhere.
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:/snap/bin"

cd "$(dirname "$0")/.."
repo_root="$(pwd)"
helper="$repo_root/scripts/backup_manifest.py"

verify=true
with_s3=true
dest_root="backups"
keep="${BACKUP_KEEP:-7}"
retention_only=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sin-verificar) verify=false ;;
    --sin-s3) with_s3=false ;;
    --destino)
      [ "$#" -ge 2 ] || { echo "Error: --destino necesita una carpeta." >&2; exit 2; }
      dest_root="$2"; shift ;;
    --conservar)
      [ "$#" -ge 2 ] || { echo "Error: --conservar necesita un número." >&2; exit 2; }
      keep="$2"; shift ;;
    --solo-retencion) retention_only=true ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done
if ! [[ "$keep" =~ ^[0-9]+$ ]]; then
  echo "Error: --conservar (o BACKUP_KEEP) debe ser un número entero >= 0: $keep" >&2
  exit 2
fi
keep=$((10#$keep))

command -v python3 >/dev/null || { echo "Error: hace falta python3 en el host." >&2; exit 1; }

started_at=$(date +%s)
# Backups hold application data (password hashes included): owner-only.
umask 077
mkdir -p "$dest_root"

# One run at a time per destination: a second one (cron overlapping a manual
# run, or a slow run reaching the next schedule) exits 75 without touching
# anything.
if command -v flock >/dev/null; then
  exec 9>"$dest_root/.lock"
  if ! flock -n 9; then
    echo "Otro backup está en curso (lock $dest_root/.lock ocupado); se omite esta ejecución." >&2
    exit 75
  fi
else
  echo "Aviso: no está flock (util-linux); no se puede evitar que dos backups se superpongan." >&2
fi

# Retention (see the header). $1 names the backup just created: never deleted.
apply_retention() {
  if [ "$keep" -eq 0 ]; then
    echo "Retención desactivada (--conservar 0): no se borra ningún backup."
    return 0
  fi
  python3 - "$dest_root" "$keep" "${1:-}" <<'PY'
import json, os, re, shutil, sys

root, keep, protect = sys.argv[1], int(sys.argv[2]), sys.argv[3]
pattern = re.compile(r"^\d{8}T\d{6}Z(\.incompleto)?$")
real_root = os.path.realpath(root)


def verified(path):
    try:
        with open(os.path.join(path, "verificacion.json"), encoding="utf-8") as handle:
            return json.load(handle).get("ok") is True
    except (OSError, ValueError, AttributeError):
        return False


good, bad = [], []
for name in os.listdir(root):
    path = os.path.join(root, name)
    if not pattern.match(name) or os.path.islink(path) or not os.path.isdir(path):
        continue
    if os.path.dirname(os.path.realpath(path)) != real_root:
        continue
    if not name.endswith(".incompleto") and verified(path):
        good.append(name)
    else:
        bad.append(name)

# Names are UTC timestamps: lexical order is chronological.
good.sort(reverse=True)
bad.sort(reverse=True)
kept_good = good[:keep]
doomed = [(name, "verificado, fuera de los %d más recientes" % keep) for name in good[keep:]]
# Unverified ones are pruned only while a verified backup is kept; the newest
# one stays for inspection.
if kept_good:
    doomed += [(name, "no verificado; se conserva sólo el más reciente") for name in bad[1:]]

removed = 0
for name, reason in doomed:
    if name == protect:
        continue
    shutil.rmtree(os.path.join(root, name))
    removed += 1
    print("Retención: se borró %s (%s)." % (os.path.join(root, name), reason))
print("Retención: %d backup(s) verificado(s) conservado(s) (máximo %d), %d borrado(s)."
      % (len(kept_good), keep, removed))
PY
}

if [ "$retention_only" = true ]; then
  apply_retention ""
  exit 0
fi

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
  set +e
  "$repo_root/scripts/verificar-backup.sh" "$final_dir"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    # The backup is good: a retention problem is reported, never fatal.
    apply_retention "$timestamp" || echo "Aviso: no se pudo aplicar la retención en $dest_root." >&2
  fi
  exit "$verify_status"
fi
echo "Verificalo con: scripts/verificar-backup.sh $final_dir"
