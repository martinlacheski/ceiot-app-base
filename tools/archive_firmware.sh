#!/usr/bin/env bash
# Copies a built ESP-IDF firmware into firmwares/<project>/<version>.bin, naming it from the
# version and project embedded in the image (esp_app_desc_t), plus a .sha256 next to it and the
# matching .elf (needed to decode core dumps of that version; not versioned in git).
# Usage: tools/archive_firmware.sh [path/to/app.bin]   (default: esp32/build/iot_device.bin)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$ROOT/esp32/build/iot_device.bin}"
[ -f "$BIN" ] || { echo "No existe: $BIN (compilá primero con idf.py build)" >&2; exit 1; }
ELF="${BIN%.bin}.elf"

read -r PROJECT VERSION < <(python3 - "$BIN" <<'EOF'
import struct, sys
data = open(sys.argv[1], "rb").read(256)
if len(data) < 112 or data[0] != 0xE9 or struct.unpack_from("<I", data, 32)[0] != 0xABCD5432:
    sys.exit("No es una imagen de aplicación ESP32 válida")
text = lambda off: data[off:off + 32].split(b"\0")[0].decode()
print(text(80), text(48))
EOF
)

DEST_DIR="$ROOT/firmwares/$PROJECT"
DEST="$DEST_DIR/$VERSION.bin"
mkdir -p "$DEST_DIR"
if [ -e "$DEST" ]; then
  if cmp -s "$BIN" "$DEST"; then echo "Ya archivado (idéntico): $DEST"; exit 0; fi
  echo "Ya existe $DEST con otro contenido. Subí la versión (PROJECT_VER en esp32/CMakeLists.txt) antes de archivar." >&2
  exit 1
fi
cp "$BIN" "$DEST"
(cd "$DEST_DIR" && sha256sum "$VERSION.bin" > "$VERSION.bin.sha256")
if [ -f "$ELF" ]; then
  cp "$ELF" "$DEST_DIR/$VERSION.elf"
else
  echo "Aviso: no se encontró $ELF; guardalo aparte para leer core dumps de esta versión." >&2
fi
echo "Archivado: $DEST"
cat "$DEST.sha256"
