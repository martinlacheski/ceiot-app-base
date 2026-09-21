#!/bin/bash

# Script para probar conectividad MQTT con TLS
# Uso: ./test_mqtt.sh <IP_BROKER> <PUERTO> <RUTA_CA> <RUTA_CERT> <RUTA_KEY>

if [ $# -lt 5 ]; then
    echo "Uso: $0 <IP_BROKER> <PUERTO> <RUTA_CA> <RUTA_CERT> <RUTA_KEY>"
    echo ""
    echo "Ejemplo:"
    echo "  $0 mqtt.example.com 8883 ./root.crt ./client.crt ./client.key"
    echo ""
    exit 1
fi

BROKER=$1
PORT=$2
CA=$3
CERT=$4
KEY=$5

echo "==============================================="
echo "Test de conectividad MQTT con TLS"
echo "==============================================="
echo ""
echo "Broker: $BROKER:$PORT"
echo "CA: $CA"
echo "Certificado: $CERT"
echo "Clave: $KEY"
echo ""

# Verificar que los archivos existan
if [ ! -f "$CA" ]; then
    echo "❌ ERROR: No se encontró el certificado CA: $CA"
    exit 1
fi

if [ ! -f "$CERT" ]; then
    echo "❌ ERROR: No se encontró el certificado del cliente: $CERT"
    exit 1
fi

if [ ! -f "$KEY" ]; then
    echo "❌ ERROR: No se encontró la clave privada: $KEY"
    exit 1
fi

echo "✅ Todos los archivos encontrados"
echo ""

# Probar conectividad con openssl
echo "Probando conexión SSL/TLS con openssl..."
echo "-------------------------------------------"

timeout 5 openssl s_client -connect $BROKER:$PORT \
    -CAfile "$CA" \
    -cert "$CERT" \
    -key "$KEY" \
    -verify_return_error \
    -quiet \
    </dev/null 2>/dev/null

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Conexión SSL/TLS exitosa"
    echo ""
else
    echo ""
    echo "❌ Error en la conexión SSL/TLS"
    echo ""
    echo "Intenta estos comandos para más detalles:"
    echo ""
    echo "# Ver el certificado CA:"
    echo "  openssl x509 -in $CA -text -noout"
    echo ""
    echo "# Ver el certificado del cliente:"
    echo "  openssl x509 -in $CERT -text -noout"
    echo ""
    echo "# Verificar que el cliente está firmado por la CA:"
    echo "  openssl verify -CAfile $CA $CERT"
    echo ""
    exit 1
fi

# Probar con mosquitto si está instalado
if command -v mosquitto_sub &> /dev/null; then
    echo "Probando con mosquitto_sub..."
    echo "-------------------------------------------"
    
    timeout 3 mosquitto_sub -h $BROKER -p $PORT \
        --cafile "$CA" \
        --cert "$CERT" \
        --key "$KEY" \
        -t "test/#" \
        -v >/dev/null 2>&1
    
    if [ $? -eq 0 ] || [ $? -eq 124 ]; then
        echo "✅ mosquitto_sub se conectó exitosamente (timeout esperado)"
        echo ""
        echo "Para publicar un mensaje de prueba:"
        echo "  mosquitto_pub -h $BROKER -p $PORT \\"
        echo "    --cafile \"$CA\" \\"
        echo "    --cert \"$CERT\" \\"
        echo "    --key \"$KEY\" \\"
        echo "    -t \"iot/devices/IOT-XXXX-XXXX/telemetry\" -m '{\"test\":\"success\"}'"
        echo ""
    else
        echo "❌ Error al conectar con mosquitto_sub"
        exit 1
    fi
else
    echo "ℹ️  mosquitto_sub no instalado (opcional)"
fi

echo "==============================================="
echo "✅ Test completado exitosamente"
echo "==============================================="
