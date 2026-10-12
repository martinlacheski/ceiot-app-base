#!/usr/bin/env bash
# Demo guiada del backup verificado, pensada para mostrar en vivo.
#
#   1. Genera un backup real con scripts/backup.sh (dump + manifiesto en el
#      mismo snapshot, copia S3 y restauración de prueba en una base descartable).
#   2. Muestra qué quedó guardado y un resumen del manifiesto.
#   3. Copia el backup a una carpeta temporal y lo daña a propósito de dos
#      maneras, para que se vea que la verificación lo detecta:
#        a) se trunca el dump            -> falla la verificación de checksums
#        b) se altera un conteo del manifiesto y se recalculan los checksums
#           -> el dump restaura bien, pero la base restaurada no coincide
#   4. Borra las copias dañadas. El backup real queda en backups/.
#
# Uso:
#   scripts/demo-backup.sh               # con pausas (Enter para avanzar)
#   scripts/demo-backup.sh --sin-pausas  # corre todo de corrido
#   scripts/demo-backup.sh --usar <backup-dir>  # no genera uno nuevo
#
# No modifica la base real: solo la lee.
set -euo pipefail

cd "$(dirname "$0")/.."

pausas=true
existente=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sin-pausas) pausas=false ;;
    --usar) existente="${2:?Falta la carpeta del backup}"; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then
  negrita=$'\033[1m'; normal=$'\033[0m'
else
  negrita=""; normal=""
fi

titulo() { printf '\n%s== %s ==%s\n\n' "$negrita" "$1" "$normal"; }
pausa() {
  if [ "$pausas" = true ]; then
    read -r -p "  [Enter para continuar] " _ </dev/tty || true
  fi
}

# --- 1. Backup real ---------------------------------------------------------
if [ -n "$existente" ]; then
  backup="$existente"
  titulo "1. Usando el backup existente $backup"
else
  titulo "1. Backup real: dump + manifiesto + S3 + restauración de prueba"
  echo "  Ejecutando scripts/backup.sh ..."
  echo
  scripts/backup.sh
  backup="$(find backups -maxdepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9]{8}T[0-9]{6}Z' | sort | tail -n 1)"
fi
[ -f "$backup/manifest.json" ] || { echo "No encuentro $backup/manifest.json" >&2; exit 1; }
pausa

# --- 2. Qué se guardó ---------------------------------------------------------
titulo "2. Qué contiene el backup"
ls -lh "$backup"
echo
python3 - "$backup/manifest.json" <<'PY'
import json, sys

m = json.load(open(sys.argv[1]))
db = m["database"]
stats = db["stats"]
tablas = {k: v for k, v in stats.items() if not k.startswith("_timescaledb")}
filas = sum(v.get("rows", 0) for v in tablas.values())
print(f"  Snapshot exportado : {m['source'].get('snapshot')}")
version = db.get("alembic_version")
print(f"  Versión de Alembic : {', '.join(version) if isinstance(version, list) else version}")
print(f"  Tablas y vistas    : {len(tablas)}  ({filas} filas en total)")
for nombre in ("telemetry_store.telemetry", "public.sensorreading", "public.deviceoperation", "public.device"):
    if nombre in stats:
        s = stats[nombre]
        rango = f"  [{s['min_time']} → {s['max_time']}]" if s.get("min_time") else ""
        print(f"    - {nombre}: {s['rows']} filas{rango}")
print(f"  Políticas RLS      : {len(db.get('policies', []))}")
s3 = m.get("s3") or {}
print(f"  Objetos S3         : {len(s3.get('objects', []))} (estado: {s3.get('status')})")
PY
echo
if [ -f "$backup/verificacion.json" ]; then
  python3 -c "import json,sys;print('  ' + json.load(open(sys.argv[1]))['resumen'].splitlines()[0])" "$backup/verificacion.json"
fi
pausa

# --- 3. Copias dañadas ----------------------------------------------------------
temporal="$(mktemp -d)"
trap 'rm -rf "$temporal"' EXIT

regenerar_checksums() {
  (cd "$1" && awk '{print $2}' SHA256SUMS | xargs -d '\n' sha256sum > SHA256SUMS.nuevo && mv SHA256SUMS.nuevo SHA256SUMS)
}

titulo "3a. Dump truncado: ¿lo detecta?"
cp -a "$backup" "$temporal/truncado"
rm -f "$temporal/truncado/verificacion.json"
tamano=$(stat -c '%s' "$temporal/truncado/db.dump")
truncate -s $((tamano / 2)) "$temporal/truncado/db.dump"
echo "  db.dump recortado de $tamano a $((tamano / 2)) bytes."
echo
scripts/verificar-backup.sh "$temporal/truncado" && echo "  (inesperado: no lo detectó)" || echo "  -> Detectado: el backup dañado se rechaza."
pausa

titulo "3b. Manifiesto alterado (con checksums recalculados): ¿lo detecta?"
cp -a "$backup" "$temporal/alterado"
rm -f "$temporal/alterado/verificacion.json"
tabla=$(python3 - "$temporal/alterado/manifest.json" <<'PY'
import json, sys

ruta = sys.argv[1]
m = json.load(open(ruta))
stats = m["database"]["stats"]
nombre = next(n for n in ("telemetry_store.telemetry", "public.device") if n in stats)
stats[nombre]["rows"] += 1
json.dump(m, open(ruta, "w"), indent=2, sort_keys=True)
print(nombre)
PY
)
regenerar_checksums "$temporal/alterado"
echo "  Se sumó 1 fila al conteo de $tabla en el manifiesto y se recalcularon"
echo "  los checksums: el dump restaura bien, pero ¿coincide con lo declarado?"
echo
scripts/verificar-backup.sh "$temporal/alterado" && echo "  (inesperado: no lo detectó)" || echo "  -> Detectado: la base restaurada no coincide con el manifiesto."

titulo "4. Fin"
echo "  Las copias dañadas se borran. El backup real queda en: $backup"
