# Aprovisionamiento de dispositivos ambientales (ESP32)

Esta carpeta contiene lo necesario para dar de alta un dispositivo ESP32 en la
plataforma, emitir su certificado mTLS y grabarle el firmware de forma que se
conecte al broker en el primer arranque, sin pasar por la interfaz web del
equipo.

| Archivo | Uso |
| --- | --- |
| `login.py` | Inicia sesión en el backend y guarda el token en `provisioning/.env.local`. |
| `provision.py` | Alta o conciliación del dispositivo, certificado, archivos para el firmware y comandos de grabación. |
| `profiles/local.json` | Broker del stack de desarrollo: `${LAN_BIND_IP}` y `${MQTT_LISTENER_TLS}` (de `mqtt/.env`), TLS activo. |
| `profiles/production.example.json` | Plantilla para producción: `${MQTT_PUBLIC_HOST}` y `${MQTT_PUBLIC_PORT:-8883}`. |
| `build/` | Carpeta de preparación por serial (se genera; no se versiona). |
| `tests/` | Pruebas unitarias de los scripts (`python3 -m unittest discover -s provisioning/tests`). |

Nada de lo que contiene secretos se versiona: `provisioning/.env.local` (token),
`provisioning/build/`, `esp32/cert/` y la CA (`mqtt/pki/ca/`) están en
`.gitignore`. Los scripts nunca muestran el token ni la contraseña.

### Variables de entorno

Los perfiles no tienen direcciones fijas: sus valores usan `${VARIABLE}` o
`${VARIABLE:-valor_por_defecto}`. Cada variable se busca, en este orden, en el
entorno del proceso, en `provisioning/.env.local`, en `mqtt/.env` y en
`backend/.env`; si no aparece y no tiene valor por defecto, el script se
detiene con un error que la nombra. Así, al cambiar `LAN_BIND_IP` o
`MQTT_LISTENER_TLS` en el stack, los equipos que se aprovisionen después
toman los valores nuevos sin editar el perfil.

La URL del backend es `CEIOT_API_BASE_URL` si está definida; si no,
`http://localhost:${BACKEND_PORT}` con `BACKEND_PORT` de `backend/.env`
(`18000` por defecto). `--api-base-url` tiene prioridad sobre ambas.

## Requisitos

- Stack levantado (`scripts/levantar.sh`) con el backend publicado en
  `BACKEND_PORT` y la CA del proyecto creada
  (`mqtt/pki/crear-ca.sh`, ver `mqtt/README.md`).
- Python 3.10 o superior y `openssl` en el sistema.
- ESP-IDF 6.1 (`~/.espressif/tools/activate_idf_v6.1.sh`) para compilar y grabar.
- Una cuenta de administrador de la plataforma.

## Sensor del firmware y seriales de demostración

Hay una sola imagen de firmware para los cuatro sensores (DHT11, DHT22,
BMP280 y BME280). El modelo en uso es una configuración del equipo guardada
en su NVS: `auto` (predeterminado) lo detecta solo, o se fija un modelo. Se
cambia desde la interfaz web del equipo (página «Dispositivo») y, en el
aprovisionamiento, con el campo `"sensor"` de `provisioning.json`.

| Serial | Nombre | Sensor en la plataforma (`--sensor`) | Clave de telemetría |
| --- | --- | --- | --- |
| `IOT-DEM0-0001` | Demo DHT11 | `dht11` | `dht11` |
| `IOT-DEM0-0002` | Demo DHT22 | `dht22` | `dht22` |
| `IOT-DEM0-0003` | Demo BME280 | `bme280` | `bme280` |
| `IOT-DEM0-0004` | Demo BMP280 | `bmp280` | `bmp280` |

Los cuatro son de tipo ambiental y pertenecen al establecimiento
«Demo · Monitoreo ambiental».

## Paso a paso

### 1. Obtener el token de la API

```bash
export CEIOT_PROVISIONING_USERNAME=<usuario administrador>
python3 provisioning/login.py
```

La contraseña se toma de `CEIOT_PROVISIONING_PASSWORD` si está definida; si no,
se solicita de forma interactiva. El token queda en `provisioning/.env.local`
(permisos `0600`) junto con `CEIOT_API_BASE_URL`, derivada de `BACKEND_PORT`
salvo que pase `--api-base-url <url>`. Cuando el token
vence, `provision.py` lo indica (error 401): repita este paso.

### 2. Preparar el dispositivo

Dispositivo con un serial existente o elegido:

```bash
python3 provisioning/provision.py prepare \
  --serial IOT-DEM0-0004 --sensor bmp280 --name "Demo BMP280" \
  --environment-of IOT-DEM0-0001
```

Para que el equipo detecte el sensor por sí mismo en lugar de fijarlo, agregue
`--firmware-sensor auto` (ver el paso 3 de «El script»).

Dispositivo nuevo con serial generado por el backend (comportamiento de DVEM):

```bash
python3 provisioning/provision.py prepare --sensor dht22 \
  --environment-id <uuid del establecimiento> \
  --model ESP32-WROOM-32 --batch 2026-10-A
```

El script:

1. **Registra o concilia el dispositivo** en la plataforma:
   - sin `--serial`, `POST /api/provisioning/devices/prepare` reserva un serial
     nuevo y deja instalado el sensor de `--sensor`;
   - con `--serial`, reutiliza el dispositivo si existe o lo da de alta con
     `POST /api/devices`;
   - deja el tipo ambiental, el nombre indicado (`--name`; por defecto
     `<SENSOR> <serial>` en altas nuevas) y lo asocia al establecimiento de
     `--environment-id` o al del dispositivo indicado en `--environment-of`.
     Un dispositivo que ya pertenece a otro establecimiento no se mueve
     (se avisa; se mueve desde la aplicación web);
   - deja **un solo sensor activo**, el de `--sensor` y con su clave
     (`dht11`, `dht22`, `bmp280` o `bme280`). Los sensores anteriores se
     desactivan, no se borran, para conservar el historial. La API de sensores
     solo opera sobre dispositivos asociados a un establecimiento: un
     dispositivo sin asociar conserva el sensor con el que se dio de alta.
2. **Certificado mTLS** con `CN = <serial>`: si existe
   `mqtt/pki/devices/<SERIAL>/`, se reutiliza después de verificar que lo firmó
   la CA del proyecto, que el CN es el serial y que la clave corresponde al
   certificado; si no existe, se emite con
   `mqtt/pki/emitir-certificado-dispositivo.sh <SERIAL>`.
3. **Preparación**: `provisioning/build/<SERIAL>/cert/` con `root.crt`,
   `client.crt`, `client.key`, `serial.txt` y `provisioning.json`: el perfil
   del broker (por defecto `profiles/local.json`; otro con `--profile`) y el
   sensor del firmware en `"sensor"`. Por defecto es el mismo modelo de
   `--sensor`, así la clave que publica el equipo coincide siempre con el
   sensor dado de alta en la plataforma; `--firmware-sensor auto` deja que el
   firmware lo detecte (o `--firmware-sensor <modelo>` fija otro).
4. **Copia a `esp32/cert/`** (la omite `--skip-firmware-copy`). Esa carpeta
   contiene siempre los archivos del último dispositivo preparado.
5. Muestra los comandos de compilación y grabación de la imagen única para
   el puerto `--port` (por defecto `/dev/ttyUSB0`).

Volver a ejecutar el script con los mismos datos no cambia nada: es seguro
repetirlo.

### 3. Compilar y grabar

Ejemplo para `IOT-DEM0-0002`, tal como lo imprime el script (la misma imagen
sirve para cualquier sensor):

```bash
source ~/.espressif/tools/activate_idf_v6.1.sh
cd esp32
idf.py reconfigure build
idf.py -p /dev/ttyUSB0 erase-flash flash
idf.py -p /dev/ttyUSB0 monitor
```

- **`reconfigure`** es necesario después de preparar otro dispositivo: la
  lista de archivos de la imagen LittleFS se fija al configurar CMake. En la
  salida debe aparecer
  `LittleFS image files: root.crt;client.crt;client.key;serial.txt;provisioning.json`.
- **`erase-flash`** borra la NVS anterior. El firmware solo toma el serial, el
  broker y el sensor de LittleFS cuando el espacio `factory` de la NVS
  todavía no los tiene; sin borrar, una placa ya usada conservaría su
  identidad y su configuración anteriores.

Para que el script compile y grabe directamente, agregue
`--flash /dev/ttyUSB0` (ejecuta `reconfigure build` y `erase-flash flash`;
el monitor se abre aparte).

### 4. Verificar

En el monitor serie, al arrancar:

```
NVS_MGR: Provisioning: factory serial IOT-DEM0-0002 from /littlefs/serial.txt
NVS_MGR: Provisioning: broker 192.168.1.100:18883 (TLS on) from /littlefs/provisioning.json
NVS_MGR: Provisioning: sensor dht22 from /littlefs/provisioning.json
SENSOR: Sensor setting: DHT22 (manual)
MQTT_MGR: Broker 192.168.1.100:18883 (mTLS), client id IOT-DEM0-0002
```

Con `"sensor": "auto"` aparece en cambio
`SENSOR: Detected DHT22; stored in NVS, not detected again on boot` (o
`No sensor detected ...` si no encuentra ninguno: revise el cableado).

Luego el dispositivo aparece conectado en la aplicación web y empieza a enviar
telemetría. En la interfaz web del equipo (punto de acceso `WiFi_CEIoT_APP`),
la pestaña **Estado** muestra en la fila **MQTT** «Conectado · mTLS · identidad
correcta» y en la fila **Sensor** el modelo en uso, con la indicación de si se
detectó automáticamente o se eligió de forma manual. El detalle de la
identidad (CN del certificado) está en la pestaña **MQTT** y el del chip
detectado, en la pestaña **Dispositivo**.

## Qué hace el firmware con estos archivos

- En el arranque, `serial.txt` y `provisioning.json` se copian al espacio
  `factory` de la NVS (serial, `mqtt_uri`, `mqtt_port`, `mqtt_use_tls` y
  `sensor_model`) si todavía no existen, y de ahí a la configuración activa
  cuando a esta le faltan. Por eso el dispositivo conserva su identidad, su
  broker y su sensor después de una restauración de fábrica. Un `"sensor"`
  inválido se registra en el log y se ignora; el broker se aplica igual.
- El sensor elegido en la interfaz web del equipo tiene prioridad sobre el de
  `provisioning.json` y se conserva tras reinicios y actualizaciones OTA.
- **Control de identidad**: si el CN de `client.crt` no coincide con el serial,
  el firmware registra el error, no inicia MQTT con TLS, levanta el punto de
  acceso y la página de estado lo muestra en rojo. Se corrige grabando los
  certificados del serial correcto (o volviendo a aprovisionar).
- Si después se cambia el serial o el broker desde la interfaz web, el cliente
  MQTT se reconecta sin reiniciar el equipo.

## Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `Missing CEIOT_API_TOKEN` o error 401 | Ejecute `provisioning/login.py`. |
| `CA not found at mqtt/pki/ca/ca.crt` | Cree la CA con `mqtt/pki/crear-ca.sh` (ver `mqtt/README.md`). |
| `... is not signed by ...` o `expected CN=...` | El certificado guardado no corresponde a esta CA o a este serial: mueva `mqtt/pki/devices/<SERIAL>/` fuera del repositorio y vuelva a ejecutar el script para emitir uno nuevo. |
| `Sensor key '...' already belongs to another model` | Otro modelo de sensor del dispositivo usa esa clave: renómbrelo desde la aplicación web. |
| El equipo arranca con el serial anterior | No se borró la flash: repita con `erase-flash`. |
| La imagen no incluye `serial.txt` | Falta `reconfigure` (o use una carpeta de compilación nueva). |
| «Sin sensor detectado» en la página de estado | Con `auto` no respondió ningún sensor: revise el cableado (I2C en GPIO21/22, DHT en GPIO4) y pulse «Detectar de nuevo», o elija el modelo a mano en «Dispositivo». |
