#!/usr/bin/env bash
set -euo pipefail

# Emite un certificado cliente para un dispositivo IoT (CN=<SERIAL>), firmado
# por la CA del proyecto, listo para cargarse en /littlefs junto al
# firmware. El broker mapea el CN del certificado al username MQTT y el ACL
# restringe ese username a sus propios tópicos (iot/devices/<SERIAL>/#).
#
# Uso: ./emitir-certificado-dispositivo.sh <SERIAL> [directorio-salida]
#   directorio-salida  Por defecto mqtt/pki/devices/<SERIAL>/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DIR="${MQTT_PKI_CA_DIR:-$SCRIPT_DIR/ca}"
CA_KEY="$CA_DIR/ca.key"
CA_CERT="$CA_DIR/ca.crt"
DAYS="${MQTT_PKI_DEVICE_DAYS:-825}"

SERIAL="${1:?Uso: emitir-certificado-dispositivo.sh <SERIAL> [directorio-salida]}"
OUT_DIR="${2:-$SCRIPT_DIR/devices/$SERIAL}"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  echo "No se encontró la CA en $CA_DIR. Ejecute crear-ca.sh primero." >&2
  exit 1
fi

if [[ -e "$OUT_DIR" ]]; then
  echo "Ya existe un certificado en $OUT_DIR." >&2
  echo "Elimínelo o indique otro directorio de salida para reemitir (p. ej. tras rotación)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP_CSR="$(mktemp)"
trap 'rm -f "$TMP_CSR"' EXIT

openssl ecparam -name prime256v1 -genkey -noout -out "$OUT_DIR/client.key"
openssl req -new -key "$OUT_DIR/client.key" -subj "/CN=${SERIAL}" -out "$TMP_CSR"

openssl x509 -req -in "$TMP_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -CAserial "$CA_DIR/ca.srl" -days "$DAYS" -sha256 \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n') \
  -out "$OUT_DIR/client.crt"

install -m 644 "$CA_CERT" "$OUT_DIR/root.crt"
chmod 600 "$OUT_DIR/client.key"
chmod 644 "$OUT_DIR/client.crt"

echo "Certificado emitido para el dispositivo ${SERIAL} en $OUT_DIR"
echo "  client.crt, client.key, root.crt -> copiar a /littlefs en el firmware"
