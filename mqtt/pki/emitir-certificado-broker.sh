#!/usr/bin/env bash
set -euo pipefail

# Emite el certificado de servidor del broker EMQX, firmado por la CA del
# proyecto, e lo instala directamente en mqtt/certs/ (leído por el
# contenedor emqx). Incluye SANs de desarrollo (emqx, localhost, 127.0.0.1)
# y, opcionalmente, nombres o direcciones IP adicionales: el hostname público
# de un despliegue real o la IP de esta máquina en la red local, para que los
# dispositivos reales validen el certificado al conectarse por esa IP.
# Cada argumento que sea una IPv4 se agrega como IP; el resto, como DNS.
#
# Uso: ./emitir-certificado-broker.sh [host-o-ip ...]
#   Sin argumentos usa LAN_BIND_IP de mqtt/.env (si está definida).
#   Ej.: ./emitir-certificado-broker.sh 192.168.1.50
#        ./emitir-certificado-broker.sh mqtt.ejemplo.com 192.168.1.50

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DIR="${MQTT_PKI_CA_DIR:-$SCRIPT_DIR/ca}"
CA_KEY="$CA_DIR/ca.key"
CA_CERT="$CA_DIR/ca.crt"
OUT_DIR="${MQTT_PKI_BROKER_OUT_DIR:-$SCRIPT_DIR/../certs}"
DAYS="${MQTT_PKI_BROKER_DAYS:-825}"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  echo "No se encontró la CA en $CA_DIR. Ejecute crear-ca.sh primero." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SAN="DNS:emqx,DNS:localhost,IP:127.0.0.1"
IPV4_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'

EXTRA_HOSTS=("$@")
# Sin argumentos, toma la IP de red local de mqtt/.env (LAN_BIND_IP), si está
# definida y no es la de loopback. Solo se lee esa variable.
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ ${#EXTRA_HOSTS[@]} -eq 0 && -f "$ENV_FILE" ]]; then
  LAN_IP="$(grep -E '^[[:space:]]*LAN_BIND_IP=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d "\"' \r")"
  if [[ -n "$LAN_IP" && "$LAN_IP" != "127.0.0.1" && "$LAN_IP" != "0.0.0.0" ]]; then
    echo "Usando LAN_BIND_IP de mqtt/.env: $LAN_IP"
    EXTRA_HOSTS=("$LAN_IP")
  fi
fi

for EXTRA_HOST in "${EXTRA_HOSTS[@]}"; do
  [[ -z "$EXTRA_HOST" ]] && continue
  if [[ "$EXTRA_HOST" =~ $IPV4_RE ]]; then
    SAN="${SAN},IP:${EXTRA_HOST}"
  else
    SAN="${SAN},DNS:${EXTRA_HOST}"
  fi
done

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
echo "Recree el contenedor emqx para que tome el certificado nuevo (desde la raíz del proyecto): docker compose up -d --force-recreate emqx"
