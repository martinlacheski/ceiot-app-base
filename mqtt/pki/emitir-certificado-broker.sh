#!/usr/bin/env bash
set -euo pipefail

# Emite el certificado de servidor del broker EMQX, firmado por la CA del
# proyecto, e lo instala directamente en mqtt/certs/ (leído por el
# contenedor emqx). Incluye SANs de desarrollo (emqx, localhost, 127.0.0.1)
# y, opcionalmente, un hostname público adicional para despliegues reales.
#
# Uso: ./emitir-certificado-broker.sh [hostname-publico]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DIR="${MQTT_PKI_CA_DIR:-$SCRIPT_DIR/ca}"
CA_KEY="$CA_DIR/ca.key"
CA_CERT="$CA_DIR/ca.crt"
OUT_DIR="${MQTT_PKI_BROKER_OUT_DIR:-$SCRIPT_DIR/../certs}"
DAYS="${MQTT_PKI_BROKER_DAYS:-825}"
PUBLIC_HOST="${1:-}"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  echo "No se encontró la CA en $CA_DIR. Ejecute crear-ca.sh primero." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SAN="DNS:emqx,DNS:localhost,IP:127.0.0.1"
if [[ -n "$PUBLIC_HOST" ]]; then
  SAN="${SAN},DNS:${PUBLIC_HOST}"
fi

openssl ecparam -name prime256v1 -genkey -noout -out "$TMP_DIR/emqx.key"
openssl req -new -key "$TMP_DIR/emqx.key" -subj "/CN=emqx" -out "$TMP_DIR/emqx.csr"

openssl x509 -req -in "$TMP_DIR/emqx.csr" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -CAserial "$CA_DIR/ca.srl" -days "$DAYS" -sha256 \
  -extfile <(printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$SAN") \
  -out "$TMP_DIR/emqx.crt"

install -m 600 "$TMP_DIR/emqx.key" "$OUT_DIR/emqx.key"
install -m 644 "$TMP_DIR/emqx.crt" "$OUT_DIR/emqx.crt"
install -m 644 "$CA_CERT" "$OUT_DIR/ca.crt"

echo "Certificado del broker emitido en $OUT_DIR"
echo "  SAN: $SAN"
echo "Recree el contenedor emqx para que tome el certificado nuevo: docker compose up -d emqx"
