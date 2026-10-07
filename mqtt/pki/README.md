# Certificados MQTT (PKI del proyecto)

Comandos para crear la CA y emitir los certificados del broker y de los
dispositivos. Se ejecutan desde esta carpeta (`mqtt/pki/`). La explicación
completa de mTLS, el ACL y qué archivo va en cada lugar está en
[`../README.md`](../README.md).

| Script | Qué hace | Dónde deja los archivos |
| --- | --- | --- |
| `crear-ca.sh` | Crea la CA raíz del proyecto (una sola vez) | `ca/ca.key`, `ca/ca.crt` |
| `emitir-certificado-broker.sh` | Certificado de servidor de EMQX | `../certs/` (lo lee el contenedor `emqx`) |
| `emitir-certificado-dispositivo.sh` | Certificado cliente de un dispositivo | `devices/<SERIAL>/` |

Ninguno de estos archivos se versiona: `ca/`, `devices/` y `../certs/` están
en `.gitignore`.

## Certificado del broker con la IP de la red local

Los dispositivos reales se conectan al broker por la IP de esta máquina en la
red local y validan que el certificado del broker incluya esa IP. Hay que
volver a emitirlo cada vez que cambia esa IP.

1. Averigüe la IP de la máquina en la red local:

   ```bash
   hostname -I | awk '{print $1}'
   ```

2. Cárguela como `LAN_BIND_IP` en `mqtt/.env` y en `backend/.env` (el mismo
   valor en los dos), y en `backend/.env` también la URL de descarga de
   firmware:

   ```dotenv
   LAN_BIND_IP=192.168.1.33
   FIRMWARE_DOWNLOAD_BASE_URL=http://192.168.1.33:18000
   ```

3. Emita el certificado del broker. Sin argumentos, el script toma
   `LAN_BIND_IP` de `mqtt/.env`:

   ```bash
   cd mqtt/pki
   ./emitir-certificado-broker.sh
   ```

   También se pueden pasar las direcciones explícitamente (cada IPv4 se agrega
   como IP y el resto como nombre DNS):

   ```bash
   ./emitir-certificado-broker.sh 192.168.1.33
   ./emitir-certificado-broker.sh mqtt.ejemplo.com 192.168.1.33
   ```

   La salida muestra los nombres incluidos, por ejemplo
   `SAN: DNS:emqx,DNS:localhost,IP:127.0.0.1,IP:192.168.1.33`.

4. Desde la raíz del proyecto, recree el broker y vuelva a levantar el stack:

   ```bash
   docker compose up -d --force-recreate emqx
   scripts/levantar.sh
   ```

5. Compruebe que el certificado instalado incluye la IP:

   ```bash
   openssl x509 -in ../certs/emqx.crt -noout -ext subjectAltName
   ```

Reemitir el certificado del broker no invalida los certificados de los
dispositivos: siguen firmados por la misma CA. Conviene reservar la IP de la
máquina en el router (DHCP estático) para no tener que repetir este proceso.

## Certificado de un dispositivo

```bash
cd mqtt/pki
./emitir-certificado-dispositivo.sh IOT-DEM0-0001
```

Crea `devices/IOT-DEM0-0001/{client.crt,client.key,root.crt}`. Para el
firmware, copie esos tres archivos a `esp32/cert/`.

## Crear la CA (solo la primera vez)

```bash
cd mqtt/pki
./crear-ca.sh
```

`./crear-ca.sh --force` regenera la CA e **invalida todos los certificados
emitidos** (broker y dispositivos). Guarde `ca/ca.key` en un respaldo offline
y no la copie nunca al backend ni a los dispositivos.
