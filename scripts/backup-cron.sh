#!/usr/bin/env bash
# Ejecuta scripts/backup.sh desde cron (lo instala scripts/instalar-backup-cron.sh).
#
# - Guarda toda la salida en backups/logs/backup-<fecha UTC>.log y borra los
#   logs de más de BACKUP_LOG_DAYS días (por defecto 30).
# - Escribe el resultado de la última ejecución en backups/ultimo-resultado.json
#   (fecha, estado ok/failed/skipped, código de salida, carpeta del backup,
#   resumen, log y resultado de la notificación).
# - Si el backup falla (código distinto de 0) o se omite porque otro sigue en
#   curso (código 75), envía un correo con el mailer de la aplicación
#   (scripts/notificar-backup.py, dentro del contenedor backend): Mailpit en
#   desarrollo, el SMTP configurado en producción. Destinatario: BACKUP_NOTIFY_EMAIL
#   o, si no está definida, el primer administrador activo.
#
# Los argumentos se pasan tal cual a scripts/backup.sh (por ejemplo
# --conservar 7). Termina con el mismo código que scripts/backup.sh.
#
# Variables (opcionales): BACKUP_DEST (carpeta raíz, por defecto backups),
# BACKUP_LOG_DAYS, BACKUP_NOTIFY_EMAIL, COMPOSE_PROJECT_NAME, y para pruebas
# BACKUP_SCRIPT y BACKUP_NOTIFY_CMD (reemplazan al backup y al notificador).
#
# Uso:
#   scripts/backup-cron.sh [opciones de scripts/backup.sh]
set -uo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'
  exit 0
fi

# cron runs with a minimal PATH and environment and without a terminal.
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:/snap/bin"
export LANG="${LANG:-C.UTF-8}"
cd "$(dirname "$0")/.." || exit 1
repo_root="$(pwd)"

dest_root="${BACKUP_DEST:-backups}"
log_days="${BACKUP_LOG_DAYS:-30}"
backup_script="${BACKUP_SCRIPT:-$repo_root/scripts/backup.sh}"
notify_cmd="${BACKUP_NOTIFY_CMD:-$repo_root/scripts/notificar-backup.py}"
[[ "$log_days" =~ ^[0-9]+$ ]] || log_days=30

umask 077
mkdir -p "$dest_root/logs" || exit 1
dest_root="$(cd "$dest_root" && pwd)"  # absolute paths in the log and the status
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log="$dest_root/logs/backup-$(date -u +%Y%m%dT%H%M%SZ).log"
status_file="$dest_root/ultimo-resultado.json"

echo "== Backup programado: inicio $started_at ==" >>"$log"
"$backup_script" --destino "$dest_root" "$@" </dev/null >>"$log" 2>&1
exit_code=$?
echo "== Fin $(date -u +%Y-%m-%dT%H:%M:%SZ): código $exit_code ==" >>"$log"

case "$exit_code" in
  0) status=ok ;;
  75) status=skipped ;;
  *) status=failed ;;
esac

# Backup folder ("Destino: ..." line of backup.sh) and a one-line summary: the
# verification verdict when there is one, otherwise the last line of output.
read_result() {
  python3 - "$log" <<'PY'
import json, os, sys

lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
backup = ""
for line in lines:
    if line.startswith("Destino: "):
        backup = line[len("Destino: "):].strip()
if backup and not os.path.isdir(backup):
    backup = ""
summary = ""
if backup:
    try:
        with open(os.path.join(backup, "verificacion.json"), encoding="utf-8") as handle:
            summary = (json.load(handle).get("resumen") or "").splitlines()[0]
    except (OSError, ValueError, IndexError, AttributeError):
        summary = ""
if not summary:
    body = [l.strip() for l in lines if l.strip() and not l.startswith("== ")]
    summary = body[-1] if body else "scripts/backup.sh terminó sin salida"
print(backup)
print(summary[:500])
PY
}
result="$(read_result 2>/dev/null || printf '\nno se pudo leer el log\n')"
backup_dir="$(printf '%s\n' "$result" | sed -n 1p)"
summary="$(printf '%s\n' "$result" | sed -n 2p)"

notification="not needed"
if [ "$status" != ok ]; then
  echo "Enviando la notificación de backup $status..." >>"$log"
  notify_output="$("$notify_cmd" --estado "$status" --codigo "$exit_code" --resumen "$summary" \
    --backup "$backup_dir" --log "$log" </dev/null 2>&1)"
  notify_code=$?
  printf '%s\n' "$notify_output" >>"$log"
  last_line="$(printf '%s\n' "$notify_output" | sed '/^[[:space:]]*$/d' | tail -n 1)"
  if [ "$notify_code" -eq 0 ]; then
    notification="sent: ${last_line:-ok}"
  else
    notification="not sent (código $notify_code): ${last_line:-sin detalle}"
  fi
fi

python3 - "$status_file" "$started_at" "$status" "$exit_code" "$backup_dir" "$summary" "$log" "$notification" <<'PY'
import datetime, json, os, sys

out, started, status, code, backup, summary, log, notification = sys.argv[1:]
data = {
    "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "started_at": started,
    "status": status,
    "ok": status == "ok",
    "exit_code": int(code),
    "backup_dir": backup or None,
    "summary": summary,
    "log": log,
    "notification": notification,
}
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
os.replace(tmp, out)
PY

# Old logs (only the ones this wrapper writes).
find "$dest_root/logs" -maxdepth 1 -type f -name 'backup-*.log' -mtime +"$log_days" -delete 2>/dev/null || true

exit "$exit_code"
