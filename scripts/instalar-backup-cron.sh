#!/usr/bin/env bash
# Programa el backup automático en el crontab del usuario actual.
#
# Administra una sola línea del crontab, marcada con el comentario
# "# ceiot-app-base backup", que ejecuta scripts/backup-cron.sh con rutas
# absolutas. Instalar de nuevo reemplaza esa línea; el resto del crontab no
# se toca. MAIL_TRANSPORT no se define en la línea: la notificación usa la
# configuración con la que corre el contenedor backend.
#
# Uso:
#   scripts/instalar-backup-cron.sh instalar [--hora HH:MM] [--conservar N]
#       Backup diario a la hora indicada (por defecto 03:00, hora del equipo)
#       conservando los N backups verificados más recientes (por defecto 7).
#   scripts/instalar-backup-cron.sh quitar
#       Quita la línea del crontab (los backups y los logs quedan).
#   scripts/instalar-backup-cron.sh estado
#       Muestra la línea instalada y el resultado de la última ejecución.
#
# Si COMPOSE_PROJECT_NAME o BACKUP_NOTIFY_EMAIL (destinatario de los avisos de
# falla) están definidas al instalar, se agregan a la línea.
# CRONTAB_CMD reemplaza al comando crontab (lo usan las pruebas).
set -euo pipefail

marker="# ceiot-app-base backup"
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

cd "$(dirname "$0")/.."
repo_root="$(pwd)"
read -r -a crontab_cmd <<<"${CRONTAB_CMD:-crontab}"

# Current crontab on stdout. "no crontab for <user>" is an empty crontab; any
# other failure aborts, so a crontab that could not be read is never replaced.
read_crontab() {
  local err out
  err="$(mktemp)"
  if out="$("${crontab_cmd[@]}" -l 2>"$err")"; then
    rm -f "$err"
    [ -z "$out" ] || printf '%s\n' "$out"
    return 0
  fi
  if grep -qi "no crontab" "$err"; then
    rm -f "$err"
    return 0
  fi
  echo "Error: no se pudo leer el crontab: $(cat "$err")" >&2
  rm -f "$err"
  return 1
}

write_crontab() { "${crontab_cmd[@]}" -; }

without_marker() { grep -vF -- "$marker" || true; }

cron_line() {
  local hour="$1" minute="$2" keep="$3" script env=""
  # Single-quoted for /bin/sh; cron itself treats % as a newline.
  script="$repo_root/scripts/backup-cron.sh"
  script="${script//\'/\'\\\'\'}"
  script="${script//%/\\%}"
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    env="COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} "
  fi
  if [ -n "${BACKUP_NOTIFY_EMAIL:-}" ]; then
    env="${env}BACKUP_NOTIFY_EMAIL=${BACKUP_NOTIFY_EMAIL} "
  fi
  # Docker outside the standard directories: cron's PATH would miss it.
  local docker_bin docker_dir
  docker_bin="$(command -v docker || true)"
  docker_dir="$(dirname "${docker_bin:-/usr/bin/docker}")"
  case ":/usr/local/bin:/usr/bin:/bin:/snap/bin:" in
    *":$docker_dir:"*) ;;
    *) env="${env}PATH=${docker_dir}:/usr/local/bin:/usr/bin:/bin " ;;
  esac
  printf "%d %d * * * %s'%s' --conservar %d %s\n" "$minute" "$hour" "$env" "$script" "$keep" "$marker"
}

install_cmd() {
  local time="03:00" keep="7"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --hora)
        [ "$#" -ge 2 ] || { echo "Error: --hora necesita HH:MM." >&2; exit 2; }
        time="$2"; shift ;;
      --conservar)
        [ "$#" -ge 2 ] || { echo "Error: --conservar necesita un número." >&2; exit 2; }
        keep="$2"; shift ;;
      *) echo "Opción desconocida: $1" >&2; exit 2 ;;
    esac
    shift
  done
  if ! [[ "$time" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]]; then
    echo "Error: --hora debe tener el formato HH:MM (00:00 a 23:59): $time" >&2
    exit 2
  fi
  local hour=$((10#${BASH_REMATCH[1]})) minute=$((10#${BASH_REMATCH[2]}))
  if ! [[ "$keep" =~ ^[0-9]+$ ]]; then
    echo "Error: --conservar debe ser un número entero >= 0: $keep" >&2
    exit 2
  fi
  keep=$((10#$keep))
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && ! [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Error: COMPOSE_PROJECT_NAME no es un nombre de proyecto válido: $COMPOSE_PROJECT_NAME" >&2
    exit 2
  fi
  if [ -n "${BACKUP_NOTIFY_EMAIL:-}" ] && ! [[ "$BACKUP_NOTIFY_EMAIL" =~ ^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$ ]]; then
    echo "Error: BACKUP_NOTIFY_EMAIL no es una dirección válida: $BACKUP_NOTIFY_EMAIL" >&2
    exit 2
  fi

  local line current
  line="$(cron_line "$hour" "$minute" "$keep")"
  current="$(read_crontab)"
  if printf '%s\n' "$current" | grep -qxF -- "$line"; then
    echo "El backup automático ya estaba instalado con esa configuración:"
    echo "  $line"
    return 0
  fi
  { printf '%s\n' "$current" | without_marker | sed '/./,$!d'; printf '%s\n' "$line"; } | write_crontab
  echo "Backup automático instalado en el crontab de $(id -un):"
  echo "  $line"
  echo "Logs: $repo_root/backups/logs/  Último resultado: $repo_root/backups/ultimo-resultado.json"
  if ! docker info >/dev/null 2>&1; then
    echo "Aviso: $(id -un) no puede usar Docker en este momento; cron corre con este usuario y lo necesita." >&2
  fi
}

remove_cmd() {
  local current
  current="$(read_crontab)"
  if ! printf '%s\n' "$current" | grep -qF -- "$marker"; then
    echo "No había ningún backup automático instalado."
    return 0
  fi
  printf '%s\n' "$current" | without_marker | sed '/./,$!d' | write_crontab
  echo "Backup automático quitado del crontab (los backups y los logs se conservan)."
}

status_cmd() {
  local current lines status_file="${BACKUP_DEST:-backups}/ultimo-resultado.json"
  current="$(read_crontab)"
  lines="$(printf '%s\n' "$current" | grep -F -- "$marker" || true)"
  if [ -n "$lines" ]; then
    echo "Backup automático instalado:"
    printf '  %s\n' "$lines"
  else
    echo "Backup automático no instalado (scripts/instalar-backup-cron.sh instalar)."
  fi
  echo
  if [ -f "$status_file" ]; then
    echo "Última ejecución ($status_file):"
    python3 -m json.tool --no-ensure-ascii "$status_file" 2>/dev/null || cat "$status_file"
  else
    echo "Todavía no hay ejecuciones registradas ($status_file)."
  fi
}

case "${1:-}" in
  instalar) shift; install_cmd "$@" ;;
  quitar) shift; [ "$#" -eq 0 ] || { echo "quitar no acepta opciones." >&2; exit 2; }; remove_cmd ;;
  estado) shift; [ "$#" -eq 0 ] || { echo "estado no acepta opciones." >&2; exit 2; }; status_cmd ;;
  -h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
