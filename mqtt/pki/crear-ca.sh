#!/usr/bin/env bash
set -euo pipefail

# Crea la Autoridad Certificadora (CA) raíz del proyecto, usada para firmar
# el certificado del broker EMQX y los certificados cliente de cada
# dispositivo IoT.
#
# La clave privada de la CA (ca.key) NUNCA debe copiarse al backend ni a
# ningún equipo que no sea el que emite certificados. Guárdela también en un
# medio offline (pendrive cifrado, gestor de secretos, etc.) fuera de este
# repositorio.
#
# Uso: ./crear-ca.sh [--force]
#   --force  Regenera la CA aunque ya exista. ¡Invalida todos los
#            certificados emitidos previamente (broker y dispositivos)!

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DIR="${MQTT_PKI_CA_DIR:-$SCRIPT_DIR/ca}"
CA_KEY="$CA_DIR/ca.key"
CA_CERT="$CA_DIR/ca.crt"
CA_CN="${MQTT_PKI_CA_CN:-CEIOT Monitoreo Ambiental IoT CA}"
CA_DAYS="${MQTT_PKI_CA_DAYS:-3650}"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ -f "$CA_KEY" && "$FORCE" -ne 1 ]]; then
  echo "La CA ya existe en $CA_DIR." >&2
  echo "Use --force para regenerarla; esto invalida todos los certificados ya emitidos (broker y dispositivos)." >&2
  exit 1
fi

mkdir -p "$CA_DIR"
chmod 700 "$CA_DIR"

openssl ecparam -name prime256v1 -genkey -noout -out "$CA_KEY"
chmod 600 "$CA_KEY"

openssl req -x509 -new -key "$CA_KEY" -sha256 -days "$CA_DAYS" \
  -subj "/CN=${CA_CN}" \
  -addext "basicConstraints=critical,CA:true" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out "$CA_CERT"
chmod 644 "$CA_CERT"

echo "CA creada en $CA_DIR"
echo "  - $CA_CERT (público, se distribuye a broker y dispositivos)"
echo "  - $CA_KEY  (privado, NUNCA sale de este equipo / respaldo offline)"
