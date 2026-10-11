# Generar los certificados MQTT desde cero

Esta guía sirve para quien acaba de clonar el repositorio y necesita crear
todos los certificados que usa el stack local: la CA del proyecto, el
certificado de servidor del broker EMQX y los certificados cliente de cada
dispositivo. Ningún certificado ni clave se versiona, así que en un clon nuevo
hay que generarlos antes del primer arranque.

El detalle de la configuración de seguridad del broker (ACL, autenticación,
revocación) está en [`mqtt/README.md`](../mqtt/README.md). El alta y grabación
completa de un ESP32 está en [`provisioning/README.md`](../provisioning/README.md).

## Resumen rápido

Desde la raíz del proyecto:

```bash
# 1. Configuración del broker (completar los valores, ver "Antes de empezar")
cp mqtt/.env.example mqtt/.env

# 2. CA del proyecto (una sola vez)
mqtt/pki/crear-ca.sh

# 3. Certificado del broker (toma LAN_BIND_IP de mqtt/.env si está definida)
mqtt/pki/emitir-certificado-broker.sh

# 4. Levantar el stack
scripts/levantar.sh --build

# 5. Certificado de un dispositivo (o usar provisioning/provision.py, paso 4)
mqtt/pki/emitir-certificado-dispositivo.sh IOT-DEM0-0001
```

Después, compruebe el resultado con la sección [Verificar](#verificar).

## Qué se genera y dónde

| Archivo | Lo genera | Lo usa | ¿Se versiona? |
| --- | --- | --- | --- |
| `mqtt/pki/ca/ca.key` | `crear-ca.sh` | Solo los scripts que firman certificados | No: clave privada de la CA |
| `mqtt/pki/ca/ca.crt` | `crear-ca.sh` | Broker y dispositivos (como CA de confianza) | No |
| `mqtt/pki/ca/ca.srl` | Scripts de emisión | Número de serie de los certificados firmados | No |
| `mqtt/certs/emqx.crt`, `emqx.key`, `ca.crt` | `emitir-certificado-broker.sh` | Contenedor `emqx` (montado en `/opt/emqx/certs`) | No |
| `mqtt/pki/devices/<SERIAL>/client.crt`, `client.key`, `root.crt` | `emitir-certificado-dispositivo.sh` | Firmware (`/littlefs`) y emulador | No |
| `provisioning/build/<SERIAL>/cert/` | `provisioning/provision.py` | Preparación del firmware | No |
| `esp32/cert/` | `provisioning/provision.py` | Imagen LittleFS del último dispositivo preparado | No |

El backend y `mqtt-runtime` **no usan certificados**: se conectan al listener
TCP interno (`emqx:1883`) con el usuario `backend-services` y la contraseña
`EMQX_BACKEND_PASSWORD` de `mqtt/.env`. Solo el listener TLS (puerto `8883`
dentro de Docker) exige certificado de cliente.

## Antes de empezar

- `bash` y `openssl` en el sistema.
- Docker con Compose, para levantar el stack.
- Python 3.10 o superior, si va a usar `provisioning/provision.py` o el
  emulador.
- `mqtt/.env` creado a partir de `mqtt/.env.example`, con estos valores:

| Variable | Para qué | Valor sugerido |
| --- | --- | --- |
| `MQTT_LISTENER_TLS` | Puerto TLS publicado en el host | `8883` (estándar; cámbielo solo si el puerto está ocupado en su máquina) |
| `MQTT_LISTENER_TCP`, `MQTT_LISTENER_WS` | Puertos TCP y WebSocket publicados | `1883` y `8083` (estándar) |
| `LAN_BIND_IP` | IP de esta máquina en la red local, para dispositivos reales | Opcional; el mismo valor en `backend/.env` |
| `EMQX_BACKEND_PASSWORD` | Contraseña del usuario `backend-services` | `openssl rand -hex 32` |
| `EMQX_PASSWORD` | Contraseña del panel de EMQX | `openssl rand -hex 64` |

## Paso 1: crear la CA

```bash
mqtt/pki/crear-ca.sh
```

Crea `mqtt/pki/ca/ca.key` (permisos `600`) y `mqtt/pki/ca/ca.crt`, válidos
por 3650 días. Si la CA ya existe, el script se detiene sin tocar nada.

Guarde una copia de `ca.key` fuera del repositorio (gestor de secretos o medio
cifrado). Si se pierde, no se pueden emitir certificados nuevos; si se filtra,
cualquiera puede hacerse pasar por el broker o por un dispositivo.

## Paso 2: emitir el certificado del broker

```bash
mqtt/pki/emitir-certificado-broker.sh [host-o-ip ...]
```

El script firma un certificado de servidor con la CA y lo instala, junto con
`ca.crt`, en `mqtt/certs/`. Emítalo **antes del primer arranque**: el listener
TLS de EMQX apunta a esos tres archivos.

Nombres incluidos en el certificado (SAN):

- Siempre: `emqx`, `localhost` y `127.0.0.1`. Alcanzan para el emulador y las
  herramientas locales.
- Los argumentos que pase: cada IPv4 se agrega como IP; el resto, como DNS.
- Sin argumentos: `LAN_BIND_IP` de `mqtt/.env`, si está definida y no es
  `127.0.0.1` ni `0.0.0.0`.

Para dispositivos reales en la red local, el certificado debe incluir la IP a
la que se conectan:

```bash
hostname -I | awk '{print $1}'         # averiguar la IP, p. ej. 192.168.1.100
# cargar LAN_BIND_IP=192.168.1.100 en mqtt/.env y en backend/.env
mqtt/pki/emitir-certificado-broker.sh  # toma LAN_BIND_IP de mqtt/.env
```

La salida muestra el SAN resultante, por ejemplo
`SAN: DNS:emqx,DNS:localhost,IP:127.0.0.1,IP:192.168.1.100`. Si el stack ya
estaba levantado, recree el broker:

```bash
docker compose up -d --force-recreate emqx
```

## Paso 3: backend y mqtt-runtime

No hay certificados que generar. Solo verifique que `EMQX_BACKEND_PASSWORD`
esté definida en `mqtt/.env`; sin ella, `docker compose` se niega a arrancar.

## Paso 4: certificados de dispositivo

Cada dispositivo tiene su propio certificado con `CN = <SERIAL>`. El broker
usa ese CN como usuario MQTT y el ACL lo limita a `iot/devices/<SERIAL>/#`.

**Para un ESP32 real**, use el aprovisionamiento. Con el stack levantado:

```bash
export CEIOT_PROVISIONING_USERNAME=<usuario administrador>
python3 provisioning/login.py
python3 provisioning/provision.py prepare \
  --serial IOT-DEM0-0004 --sensor bmp280 --name "Demo BMP280" \
  --environment-of IOT-DEM0-0001
```

`provision.py` emite el certificado si `mqtt/pki/devices/<SERIAL>/` no existe,
o lo reutiliza tras comprobar la firma, el CN y la clave. Luego lo copia a
`provisioning/build/<SERIAL>/cert/` y a `esp32/cert/` junto con `serial.txt` y
`provisioning.json` (broker `${LAN_BIND_IP}:${MQTT_LISTENER_TLS}` del perfil
`provisioning/profiles/local.json`). Las opciones completas y la grabación
están en [`provisioning/README.md`](../provisioning/README.md).

**Para el emulador u otra prueba sin hardware**, alcanza con el script:

```bash
mqtt/pki/emitir-certificado-dispositivo.sh IOT-DEM0-0001
```

Crea `mqtt/pki/devices/IOT-DEM0-0001/` con `client.crt`, `client.key` y
`root.crt` (copia de `ca.crt`), válidos por 825 días. El script no sobrescribe
un directorio existente.

## Verificar

Desde la raíz del proyecto:

```bash
# El certificado del broker está firmado por la CA y tiene los SAN esperados
openssl verify -CAfile mqtt/pki/ca/ca.crt mqtt/certs/emqx.crt
openssl x509 -in mqtt/certs/emqx.crt -noout -ext subjectAltName -enddate

# El broker usa la misma CA que firmó los dispositivos (sin salida = iguales)
cmp mqtt/certs/ca.crt mqtt/pki/ca/ca.crt

# El contenedor está sano
docker compose ps emqx

# Handshake mTLS real con el certificado de un dispositivo
openssl s_client -connect localhost:8883 \
  -CAfile mqtt/pki/ca/ca.crt \
  -cert mqtt/pki/devices/IOT-DEM0-0001/client.crt \
  -key mqtt/pki/devices/IOT-DEM0-0001/client.key \
  -verify_hostname localhost -verify_return_error -brief </dev/null
```

El último comando debe mostrar `Verification: OK`. Para probar el acceso por
la red local, use `-connect <LAN_BIND_IP>:8883` y reemplace
`-verify_hostname localhost` por `-verify_ip <LAN_BIND_IP>`. Reemplace `8883`
si definió otro `MQTT_LISTENER_TLS`.

Para una prueba de punta a punta (mTLS, broker, `mqtt-runtime` y base de
datos), use el emulador descrito en [`mqtt/README.md`](../mqtt/README.md):
`python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001`.

## Variables de los scripts

Los valores por defecto sirven para el desarrollo local; estas variables solo
hacen falta para cambiarlos.

| Variable | Script | Por defecto |
| --- | --- | --- |
| `MQTT_PKI_CA_DIR` | Los tres | `mqtt/pki/ca` |
| `MQTT_PKI_CA_CN` | `crear-ca.sh` | `CEIOT Monitoreo Ambiental IoT CA` |
| `MQTT_PKI_CA_DAYS` | `crear-ca.sh` | `3650` |
| `MQTT_PKI_BROKER_OUT_DIR` | `emitir-certificado-broker.sh` | `mqtt/certs` |
| `MQTT_PKI_BROKER_DAYS` | `emitir-certificado-broker.sh` | `825` |
| `MQTT_PKI_DEVICE_DAYS` | `emitir-certificado-dispositivo.sh` | `825` |
| `LAN_BIND_IP` | `emitir-certificado-broker.sh` (leída de `mqtt/.env`) | Sin definir |

## Rotar o regenerar

| Qué | Cómo | Impacto |
| --- | --- | --- |
| Certificado del broker (cambió la IP, vence pronto) | Volver a correr `emitir-certificado-broker.sh` y recrear `emqx` | Ninguno sobre los dispositivos: siguen firmados por la misma CA |
| Certificado de un dispositivo | Borrar `mqtt/pki/devices/<SERIAL>/`, volver a emitirlo (o a aprovisionar) y regrabar el equipo | Solo ese dispositivo. El certificado anterior sigue siendo válido hasta vencer: no hay CRL |
| CA | `mqtt/pki/crear-ca.sh --force`, luego reemitir el broker y **todos** los dispositivos | Invalida todos los certificados emitidos; hay que regrabar cada equipo |

La revocación inmediata de un dispositivo (regla `deny` en `mqtt/acl.conf`)
está en la sección "Rotación y revocación" de [`mqtt/README.md`](../mqtt/README.md).

## Errores frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `hostname mismatch` / `IP address mismatch`, o el ESP32 no completa el handshake | La IP o el nombre usado para conectarse no está en el SAN del broker | Reemitir el certificado del broker con esa IP o nombre y recrear `emqx` |
| `unknown ca` / `unable to get local issuer certificate` | El dispositivo y el broker usan CA distintas (por ejemplo, después de `crear-ca.sh --force`) | Comparar `root.crt` del dispositivo con `mqtt/certs/ca.crt` usando `cmp`; reemitir y regrabar si difieren |
| `certificate has expired` | El certificado venció | Revisar con `openssl x509 -noout -enddate -in <archivo>` y reemitir |
| `TLSV13_ALERT_CERTIFICATE_REQUIRED` | El cliente no presentó certificado | Revisar que existan `client.crt` y `client.key` (en `/littlefs` o en `--cert-dir`) |
| `Permission denied` al instalar en `mqtt/certs/` | El stack se levantó antes de emitir el certificado y Docker creó la carpeta como `root` | `sudo chown -R "$USER" mqtt/certs` y volver a emitir |
| `No se encontró la CA ...` | Falta el paso 1 | Correr `mqtt/pki/crear-ca.sh` |
| `Ya existe un certificado en ...` | El dispositivo ya tiene certificado | Reutilizarlo, o borrar el directorio para reemitir |

Con la configuración actual del firmware (`CONFIG_MBEDTLS_HAVE_TIME_DATE`
deshabilitado), el ESP32 no valida fechas de certificados; `openssl` y el
emulador sí.

## Seguridad

- No commitee claves ni certificados. `.gitignore` cubre `*.key`, `*.pem`,
  `*.crt`, `*.csr`, `*.srl`, `mqtt/certs/`, `mqtt/pki/ca/`,
  `mqtt/pki/devices/`, `esp32/cert/`, `provisioning/build/` y todos los
  `.env`. Antes de un commit, `git status` no debe listar ninguno de esos
  archivos.
- `ca.key` nunca se copia al backend ni a otra máquina; guarde el respaldo
  fuera del repositorio.
- No comparta `client.key` entre dispositivos: cada equipo tiene el suyo.
- `crear-ca.sh --force` es destructivo: invalida todos los certificados
  emitidos.
