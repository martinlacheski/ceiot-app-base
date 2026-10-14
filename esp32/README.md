# Firmware del dispositivo ambiental CEIoT (ESP32)

Firmware para las placas ESP32-WROOM-32 (ESP32 clásico, 4 MB de flash, sin
PSRAM) que publican lecturas ambientales al backend de CEIoT por MQTT con mTLS.

## Primeros pasos: conectar el equipo al Wi-Fi

Para un equipo recién grabado y provisionado (serial y certificados cargados,
ver `provisioning/README.md`). El detalle completo está en
[AP de configuración, botón BOOT y LED de estado](#ap-de-configuración-botón-boot-y-led-de-estado).

1. **Encendé el equipo.** Si no tiene una red Wi-Fi guardada, levanta solo el
   punto de acceso de configuración y el LED (GPIO2) parpadea rápido (también
   lo levanta si le falta el serial o si el CN del certificado no coincide con
   el serial). Si ya tenía una red, mantené apretado el botón BOOT 3 s o más
   y soltalo (desde los 3 s el LED queda fijo mientras lo mantenés).
2. **Conectate al punto de acceso** desde el celular o la PC: red
   `WiFi_CEIoT_APP`, contraseña `ceiotapp` (WPA2).
3. **Abrí <http://192.168.4.1>** e iniciá sesión con `admin` / `admin` (cambiá la
   contraseña en la pestaña "Seguridad").
4. **Pestaña "Wi-Fi"**: tocá "Buscar redes", elegí tu red (o escribí el nombre
   en "Red (SSID)"), completá "Contraseña" y tocá "Conectar". El firmware
   exige una red con WPA2 o superior. La red se guarda recién cuando la
   conexión funciona; el equipo no se reinicia. La pestaña muestra el estado,
   la IP obtenida y la señal.
5. **Pestaña "MQTT"**, sección "Broker" (si lo provisionaste con
   `provisioning/provision.py`, estos valores ya vienen cargados; revisalos):
   - **Host**: la IP de tu PC en la red local, es decir `LAN_BIND_IP` del
     `.env` de la raíz.
   - **Puerto**: `MQTT_LISTENER_TLS` de `mqtt/.env` (`8883` en la
     configuración estándar).
   - **Usar TLS (mTLS)**: marcado.
   - **URL del backend (hora por HTTP)**: opcional; vacío usa
     `http://<host del broker>:8000`.

   Tocá "Guardar": el cliente MQTT se reconecta con la nueva configuración,
   sin reiniciar. El certificado del broker tiene que incluir esa IP en su
   SAN; ver [`../docs/certificados-mqtt.md`](../docs/certificados-mqtt.md#paso-2-emitir-el-certificado-del-broker).
6. **Apagá el punto de acceso**: "Desactivar punto de acceso" en la pestaña
   "Wi-Fi", u otra pulsación de BOOT de 3 s o más. Mientras el AP está activo
   el LED siempre parpadea rápido, así que recién con el AP apagado muestra el
   estado de la conexión. Después de apagarlo, la interfaz web sigue
   disponible en la IP que el equipo obtuvo en tu red.
7. **Mirá el LED**: fijo = MQTT conectado (listo); parpadeo lento = Wi-Fi
   conectado, MQTT todavía no; destello corto cada 2 s = sin conexión. Si
   MQTT no conecta, la pestaña "Estado" muestra la alerta con el último error.

Para volver al modo configuración, repetí el paso 1 (BOOT 3 s o más y
soltar). Mantener BOOT 10 s o más hace un reset de fábrica: borra la red
Wi-Fi y la contraseña web, y vuelve el broker y el sensor a los valores
provisionados.

## Requisitos

- ESP-IDF **6.1** (`source ~/.espressif/tools/activate_idf_v6.1.sh`).
- Acceso al registro de componentes en la primera compilación (cJSON, MQTT,
  mDNS y LittleFS se descargan en `managed_components/`, fijados por
  `dependencies.lock`).

## Compilación

```sh
source ~/.espressif/tools/activate_idf_v6.1.sh
cd esp32
idf.py set-target esp32   # solo una vez por clon
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

Para provisionar un dispositivo (registro en el backend, certificado, serial y
perfil del broker en LittleFS, comandos de compilación y grabación) usá
`provisioning/provision.py`; la guía paso a paso está en
`provisioning/README.md`.

La imagen de la aplicación es `build/iot_device.bin`: el nombre del proyecto
tiene que seguir siendo `iot_device`, el único firmware que el backend y la
aplicación web aceptan para OTA (`FIRMWARE_PROJECT` en
`backend/app/api/device/firmware/rules.py`). Incrementá `PROJECT_VER` en
`esp32/CMakeLists.txt` en cada imagen que publiques para OTA.

## Certificados del dispositivo (mTLS)

El broker exige un certificado cliente por dispositivo. Los archivos **nunca
se suben al repositorio**: el contenido de `esp32/cert/` está en el gitignore,
salvo los marcadores `*.example`, que solo muestran los nombres de archivo
esperados y cómo se genera cada uno (no son certificados válidos y la
compilación los ignora):

| Archivo | Contenido |
| --- | --- |
| `esp32/cert/root.crt` | CA que firmó el certificado del broker |
| `esp32/cert/client.crt` | certificado del dispositivo (CN = serial del dispositivo) |
| `esp32/cert/client.key` | clave privada del dispositivo |
| `esp32/cert/serial.txt` | serial del dispositivo, `IOT-XXXX-XXXX` (opcional) |
| `esp32/cert/provisioning.json` | perfil del broker y sensor (opcional) |

Ver `mqtt/README.md` para emitirlos con los scripts de PKI del proyecto.

- Con los tres archivos presentes, la compilación genera `build/storage.bin`
  (LittleFS) e `idf.py flash` lo graba en la partición `storage`.
  `serial.txt` y `provisioning.json` (que `provisioning/provision.py` escribe
  ahí) también se empaquetan cuando existen; el paso de configuración registra
  `LittleFS image files: ...`. La lista se fija cuando corre CMake: ejecutá
  `idf.py reconfigure` después de preparar otro dispositivo.
- Al arrancar, `serial.txt` y `provisioning.json` (`mqtt_uri`, `mqtt_port`,
  `mqtt_use_tls` y el `sensor` opcional: `auto` o un modelo) completan el
  namespace NVS `factory` cuando todavía no tiene esos valores (enfoque de
  DVEM, `main/web/nvs_manager.c`), y desde ahí la configuración activa de
  `storage` que todavía falte: una placa recién grabada se conecta sin pasar
  por la interfaz web. Un `sensor` inválido se registra en el log y se ignora
  (el perfil del broker se aplica igual). Reprovisionar una placa usada
  requiere `idf.py erase-flash`.
- Control de identidad: el CN del certificado cliente tiene que ser igual al
  serial (el broker toma el CN como nombre de usuario MQTT). Si no coinciden, o
  el CN no se puede leer, el firmware registra un error, no inicia MQTT sobre
  TLS y levanta el AP de configuración; la página de estado muestra una alerta
  y la página MQTT lo indica (`Identidad`).
- Sin ellos (clon recién hecho) la compilación funciona igual e imprime una
  advertencia de CMake; los certificados se pueden subir después desde la
  interfaz web.
- En el primer arranque con certificados se guarda una copia en el namespace
  NVS `factory`, así un reset de fábrica los restaura.

## Tabla de particiones (4 MB)

| Nombre | Tipo | Offset | Tamaño |
| --- | --- | --- | --- |
| nvs | data/nvs | 0x9000 | 24 KB |
| otadata | data/ota | 0xF000 | 8 KB |
| phy_init | data/phy | 0x11000 | 4 KB |
| storage | data/littlefs | 0x12000 | 56 KB |
| ota_0 | app | 0x20000 | 1920 KB (0x1E0000) |
| ota_1 | app | 0x200000 | 1920 KB (0x1E0000) |
| coredump | data/coredump | 0x3E0000 | 128 KB |

No hay aplicación de fábrica: la primera grabación escribe `ota_0`, las
actualizaciones OTA alternan entre las dos ranuras y
`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` revierte una imagen que no se valida a
sí misma. Una imagen OTA no puede superar **1966080 bytes** (0x1E0000): el
backend rechaza subidas más grandes (`MAX_IMAGE_BYTES`) y el dispositivo
responde `image_too_large`.

## Modelo de sensor (configuración en tiempo de ejecución)

Una sola imagen maneja los cuatro sensores soportados: los drivers de DHT11,
DHT22, BMP280 y BME280 siempre están enlazados. Cuál se usa es una
configuración en tiempo de ejecución guardada en NVS (namespace `storage`),
así sobrevive a reinicios y actualizaciones OTA:

| Clave NVS (`storage`) | Contenido |
| --- | --- |
| `sensor_model` | `auto` (por defecto si no existe), `dht11`, `dht22`, `bmp280` o `bme280` |
| `sensor_detected` | modelo encontrado por la última autodetección (solo se usa con `auto`) |

La configuración viene de la interfaz web (página "Dispositivo": selector de
modelo, "Guardar sensor", "Detectar de nuevo") o, en el primer arranque, de
`provisioning.json` (`"sensor"`, escrito por `provisioning/provision.py`). Un
cambio desde la interfaz web lo aplica la tarea de telemetría en pocos
segundos, sin reiniciar. Los pines, la dirección y la frecuencia de I2C y el
período de telemetría siguen en `main/config/config.h`.

| Modelo | Conexión (valores por defecto, editables en `config.h`) | Clave de telemetría | Variables |
| --- | --- | --- | --- |
| DHT11 | datos GPIO4 | `dht11` | `temperature`, `relative_humidity` |
| DHT22 / AM2302 | datos GPIO4 | `dht22` | `temperature`, `relative_humidity` |
| BMP280 | I2C SDA GPIO21, SCL GPIO22, dirección 0x76 o 0x77 | `bmp280` | `temperature`, `pressure` |
| BME280 | I2C SDA GPIO21, SCL GPIO22, dirección 0x76 o 0x77 | `bme280` | `temperature`, `relative_humidity`, `pressure` |

La clave de telemetría es el modelo en uso (configurado a mano o
autodetectado). Unidades: °C, % y hPa. Las claves y variables coinciden con el
catálogo de sensores del backend
(`backend/app/api/sensor_catalog/constants.py`). Los drivers vienen de
esp-idf-lib (`esp-idf-lib/dht`, `esp-idf-lib/bmp280`, que también maneja el
BME280; el bus I2C funciona a 100 kHz). Un valor fallido o inverosímil (NaN,
fuera del rango del sensor, la trama DHT toda en cero) nunca se publica: esa
variable se omite (una trama DHT con un valor fuera de rango se descarta
entera) y, cuando no queda nada válido, se saltea el ciclo. Cada lectura DHT
registra sus valores crudos en el log.

### Autodetección

Con la configuración `auto`, el firmware detecta el sensor en el primer
arranque (o después de "Detectar de nuevo", o al pasar de un modelo manual a
`auto`) y guarda el resultado en `sensor_detected`, así los arranques
siguientes no vuelven a detectar:

1. **I2C** (SDA 21, SCL 22, 100 kHz): un sondeo solo de dirección en 0x76 y
   después en 0x77; del primer chip que responde se lee el registro de ID
   (0xD0): `0x60` → BME280, `0x58` (también `0x56`/`0x57`, muestras tempranas
   de BMP280) → BMP280. Cualquier otro ID se ignora. El sondeo libera el
   dispositivo I2C (y el bus) cuando nada responde.
2. **DHT en GPIO4**, leído como DHT22 (decodificación AM2301): una trama
   válida con humedad 0-100 % y temperatura -40..80 °C → DHT22. Si no, al
   menos 2 s después, se lee como DHT11: humedad entera 5-95 % y temperatura
   0..50 °C → DHT11. Una trama de DHT11 decodificada como DHT22 da una humedad
   muy por encima de 100 % (su byte entero cae en el byte alto), lo que
   permite distinguirlos.
3. No se encontró nada: el log lo indica, no se publica nada, la página de
   estado muestra "Sin sensor detectado" y la detección se reintenta cada
   `SENSOR_DETECT_RETRY_SEC` (60 s) mientras la configuración sea `auto`.

Las reglas de decisión son C puro (`main/sensor/sensor_logic.c`, con tests en
el host); un modelo manual saltea la detección. El driver BMP280 de
esp-idf-lib solo acepta los ID de chip `0x58` y `0x60`: un BMP280 de muestra
temprana (`0x56`/`0x57`) se detecta pero después falla al inicializarse (se
registra en cada ciclo).

## Contrato MQTT

Client id = serial del dispositivo (`IOT-XXXX-XXXX`, configurado desde la
interfaz web). Los tópicos siguen a `tools/emulador-dispositivo.py`:

| Tópico | QoS / retain | Payload |
| --- | --- | --- |
| `iot/devices/{serial}/telemetry` | 1 | `{"sensors":{"dht22":{"temperature":23.4,"relative_humidity":51.2}},"uptime":125,"firmware_version":"0.1.0"}` |
| `iot/devices/{serial}/status` | 1, retenido | `{"serial":"…","status":"online"}` en cada conexión; Last Will `"offline"` |
| `iot/devices/{serial}/ota/command` | 1, suscripto | `{"request_id","version","url","sha256","size","force"?}` (ver "Actualizaciones OTA") |
| `iot/devices/{serial}/ota/status` | 1 | `{"request_id","state","progress"?,"error"?:{"code","message"},"running_version","target_version"}` |
| `iot/devices/{serial}/ota/check` | 1 | `{"request_id","running_version"}` ("Buscar actualización" en la interfaz web) |
| `iot/devices/{serial}/ota/request` | 1 | `{"request_id","version","running_version"}` ("Actualizar a X" en la interfaz web) |
| `iot/devices/{serial}/ota/available` | 1, suscripto | `{"request_id","version"\|null,"size"?,"error"?:{"code","message"}}` (respuesta a check, o pedido rechazado) |

La telemetría se publica cada `TELEMETRY_INTERVAL_SEC` (60 s por defecto) y
justo después de cada conexión. `firmware_version` es `PROJECT_VER` de
`esp32/CMakeLists.txt`.

Configuración del broker (`main/mqtt/mqtt_config_logic.c`, con tests en el
host): lo que la página MQTT guardó en NVS `storage` o, si no hay nada, los
valores por defecto: **mTLS en el puerto 8883 hacia `192.168.1.100`** (un host
de ejemplo). Una placa recién grabada (todavía sin namespace `storage`) usa
esos valores por defecto, así que con sus certificados en `esp32/cert/` y un
serial se conecta sin pasar por la interfaz web. El serial sale de `storage`
o, si no está, de la copia `factory`. Sin serial no hay client id ni identidad
de tópicos: el log lo indica (`No device serial in NVS`), MQTT no arranca y se
levanta el AP de configuración para poder cargar el serial. Guardar el serial
o la configuración del broker desde la interfaz web reconstruye y reinicia el
cliente MQTT (`mqtt_manager_request_reload()`): no hace falta reiniciar.

Estos valores compilados solo se aplican cuando no hay nada más configurado.
Una placa grabada con un `provisioning.json` (ver "Certificados del
dispositivo") toma de ahí el host, el puerto y el indicador de TLS del broker
en el primer arranque, así que lo habitual es dejar que
`provisioning/provision.py` escriba ahí los valores del stack (`LAN_BIND_IP`
del `.env` de la raíz y `MQTT_LISTENER_TLS` de `mqtt/.env`, `8883` en la
configuración estándar; ver `esp32/cert/provisioning.json.example`). Sin ese
archivo, cambialos en la página MQTT o en `mqtt_config_logic.h`, por ejemplo
cuando el stack publica el listener TLS del broker en un puerto distinto del
estándar `8883`.

## Sincronización horaria

Implementada en `main/timesync/` (reglas en `time_sync_logic.c`, con tests en
el host), según `backend/docs/mqtt-time-sync.md`:

1. **NTP**: SNTP (`time.google.com`, `pool.ntp.org`, más el servidor que
   entrega DHCP) corre desde el arranque; tiene los primeros 15 s después de
   que la estación obtiene IP.
2. **HTTP**: si el reloj sigue sin configurar, `GET {backend}/api/public/time`
   por HTTP plano (timeout de 5 s), reintentado cada 60 s mientras no esté
   sincronizado. `{backend}` es la "URL del backend" de la página MQTT (NVS
   `storage` / `backend_url`); vacía significa `http://<host del broker MQTT>:8000`,
   el `BACKEND_PORT` estándar (`.env` de la raíz) que docker compose publica
   para el backend (`LAN_BIND_IP` tiene que exponerlo a la LAN, igual que para
   las descargas de firmware).
3. **MQTT**: el cliente arranca cuando el reloj es válido, **o** cuando NTP
   agotó su tiempo y ya se intentó HTTP, así nunca queda bloqueado para
   siempre. Mientras el reloj siga sin configurar publica `{"req_id":"t-N"}` en
   `iot/devices/{serial}/time/request` (QoS 1, reintentado cada 30 s) y ajusta
   el reloj con la respuesta correspondiente en `iot/devices/{serial}/time`
   (`epoch_ms` + la mitad del tiempo de ida y vuelta).

Por qué MQTT puede conectarse sin un reloj válido:
`CONFIG_MBEDTLS_HAVE_TIME_DATE` sigue deshabilitada (valor por defecto de
ESP-IDF), así que el handshake mTLS verifica la cadena de certificados del
broker y las firmas, pero no las fechas de validez. Habilitarla haría
imposible el paso 3 sin NTP o HTTP, y además un certificado vencido detendría
al dispositivo. La telemetría no lleva timestamp (el backend registra la hora
de recepción), así que un dispositivo sin hora igual reporta. La página de
estado muestra la fuente de la hora (`ntp`, `http`, `mqtt`, o `rtc` cuando un
reloj válido sobrevivió a un reinicio por software), en mayúsculas (`NTP`,
`HTTP`, `MQTT`, `RTC`) junto a la hora local.

## Actualizaciones OTA

Implementadas en `main/ota/` (reglas en `ota_logic.c`, con tests en el host;
integración en `ota_manager.c`), portadas de DVEM-App
`devices/esp-idf-guition-1r1p` sin sus pantallas, ventas ni PSRAM. Contrato:
`tools/emulador-dispositivo.py --ota` y `backend/app/api/device/firmware/`.

1. `ota/command` se suscribe en cada (re)conexión MQTT. El dispositivo
   responde en `ota/status` (QoS 1) repitiendo el `request_id`: `rejected` con
   `busy` (otra actualización en curso, o la imagen nueva todavía
   validándose), `invalid_command` (url que no es `http://`/`https://`, sha256
   que no son 64 caracteres hex en minúscula, size que no es un entero
   positivo, version que no tiene 1..32 caracteres, `force` que no es
   booleano), `image_too_large` (`size` mayor que la ranura OTA, 0x1E0000) o
   `same_version` (salvo con `force`); si no, `accepted`. Un `request_id`
   reentregado repite su último estado y nunca se ejecuta dos veces.
2. `downloading` con `progress` cada 10 % (o cada 5 s si hubo avance):
   `esp_http_client` descarga la imagen en la otra ranura OTA mientras calcula
   su SHA-256. Se acepta http plano en la LAN (el comando llega por mTLS y
   trae el SHA-256); https verifica el servidor con el bundle de certificados
   de ESP-IDF (CA comunes). Las redirecciones se rechazan: la url tiene que
   ser la final.
3. `verifying`: el tamaño y el SHA-256 tienen que coincidir con el comando
   (`size_mismatch` / `sha256_mismatch`), y `esp_ota_end` verifica la imagen;
   la partición de arranque nunca se cambia antes de eso.
4. `installing`: el marcador `{request_id, target_version, previous_version,
   target_slot}` se guarda en NVS (`ota`/`marker`), se cambia la partición de
   arranque, `rebooting`, reinicio.
5. La imagen nueva arranca en `PENDING_VERIFY` (rollback habilitado). Se marca
   válida cuando Wi-Fi y MQTT están arriba, dentro de 180 s; si no, se
   revierte. Una vez conectada publica `succeeded` para el `request_id`
   guardado (o `rolled_back` / `rollback` cuando el bootloader volvió a la
   imagen anterior) y recién entonces borra el marcador.

Las demás fallas terminan en `failed` con `download_failed`, `tls_error`,
`flash_error`, `no_ota_partition`, `no_memory` o `internal`; la imagen en uso
no cambia.

### Actualizaciones iniciadas desde el dispositivo (página "Firmware" de la interfaz web)

Reglas en `main/ota/ota_remote.c` (con tests en el host), integración en
`ota_manager.c`; portado de DVEM-App `ota_remote` / `ota_flow` sin la
pantalla del dispositivo. Del lado del backend:
`FirmwareService.handle_check` / `handle_request`.

1. "Buscar actualización" (`POST /api/ota/check`) publica `ota/check`
   `{"request_id":<uuid>,"running_version"}`. El backend responde en
   `ota/available` (suscripto en cada conexión) con la última versión activa:
   `{"request_id","version":"0.3.0","size":…}`, o `"version":null` cuando el
   dispositivo ya la tiene (o no hay ninguna). La respuesta, su antigüedad y
   cualquier error se muestran en la página (`/api/status` → `ota.check`). Sin
   respuesta en 20 s → `timeout`.
2. "Actualizar a X" (habilitado solo después de una respuesta con versión,
   con MQTT conectado y nada en curso; `POST /api/ota/request`) publica
   `ota/request` `{"request_id":<uuid nuevo>,"version":"X","running_version"}`.
   El backend hace los mismos controles que en una actualización iniciada
   desde la plataforma y envía el `ota/command` habitual con ese
   `request_id`, así que se aplica el flujo anterior (progreso en la página
   desde `ota.active`). Un rechazo llega por `ota/available` con `error`
   (`release_unavailable`, `in_progress`, `same_version`, `internal`).
3. "Cambiar a X" (`POST /api/ota/switch`) arranca la imagen que ya está en la
   otra ranura OTA cuando se puede leer, es de otra versión y no está marcada
   como inválida/pendiente (`ota_prev_decide`). Es solo local: el backend no
   tiene esa operación. Se guarda un marcador con request id
   `local-switch:<uuid>`, `esp_ota_set_boot_partition` verifica la imagen y el
   dispositivo se reinicia; después rigen las reglas habituales (se valida
   cuando Wi-Fi + MQTT están arriba dentro de 180 s; si no, el bootloader
   vuelve atrás). El `ota/status` final sale con el id `local-switch:`, que el
   backend ignora (intento desconocido); la plataforma ve la versión nueva en
   el `firmware_version` de la telemetría. Después de una grabación por cable
   la otra ranura puede tener una imagen vieja ("grabada por cable", otadata
   borrado): también se ofrece y la protege la misma validación.

### Presupuesto de heap (sin PSRAM; cambio 50 de DVEM adaptado)

DVEM movió mbedTLS a PSRAM y deshabilitó el AES por hardware porque su S3 se
quedaba sin RAM interna. Nada de eso aplica acá: no hay PSRAM, y el
acelerador AES del ESP32 clásico no usa el buffer intermedio de DMA que
fallaba en el S3. En cambio, todo queda en RAM interna y se controla el
presupuesto:

- Uso estático de DRAM (imagen única, todos los drivers de sensor): 45.1 KB de
  176.5 KB (`idf.py size`), lo que deja ~131 KB para el heap antes de Wi-Fi,
  lwIP, las pilas de las tareas y el cliente MQTT. Heap libre esperado con
  Wi-Fi, el servidor web y la sesión MQTT mTLS activos: aproximadamente
  90-120 KB (a confirmar en la placa).
- MQTT mTLS con `CONFIG_MBEDTLS_DYNAMIC_BUFFER` y los datos de configuración
  liberados: unos 35 KB en el pico del handshake, mucho menos una vez
  conectado.
- Descarga por http: pila de tarea de 6 KB + bloque de 4 KB + ~3.5 KB de
  buffers HTTP + la ventana de recepción de lwIP, ~20 KB. Requisito para
  empezar: 32 KB libres y un bloque de 12 KB.
- Descarga por https: una segunda sesión TLS (pico del handshake ~35-40 KB,
  registro de entrada de hasta 16 KB) y una pila de 10 KB, ~60 KB. Requisito:
  64 KB libres y un bloque de 24 KB.

Por debajo de esos umbrales la actualización termina en `failed` /
`no_memory` antes de tocar la flash. El log serie imprime el heap libre, el
bloque más grande y el mínimo histórico antes de la descarga, a la mitad, al
terminarla y cuando finaliza la tarea, además de la marca de máximo uso de la
pila de la tarea; el bucle principal imprime el heap libre cada 5 minutos.

## AP de configuración, botón BOOT y LED de estado

| Botón BOOT (GPIO0) | Efecto |
| --- | --- |
| pulsación corta (< 3 s) | nada |
| mantener ≥ 3 s y soltar | alterna el AP de configuración: lo levanta si está apagado y lo apaga si está activo |
| mantener ≥ 10 s | reset de fábrica (se dispara mientras se sigue manteniendo) y reinicio |

- AP: SSID `WiFi_CEIoT_APP`, contraseña `ceiotapp` (WPA2), interfaz web en
  <http://192.168.4.1>. Funciona como AP+STA, así que el dispositivo mantiene
  su conexión Wi-Fi (y la telemetría) mientras el AP está activo. También se
  levanta solo cuando no hay una red Wi-Fi guardada. Queda activo hasta el
  reinicio, otra pulsación de BOOT de 3 s o "Desactivar punto de acceso" en la
  página Wi-Fi.
- Login web: `admin` / `admin` por defecto (cambiala en "Seguridad"). Seis
  pestañas iguales (3x2 en celulares); "Cerrar sesión" está a la derecha del
  título de cada página. "Estado" es una sola tarjeta de resumen: serial,
  firmware, tiempo encendido, hora local y su fuente; una única alerta solo
  cuando algo requiere atención (en orden de prioridad: CN del certificado vs.
  serial, MQTT desconectado con su último error, chip I2C distinto del sensor
  en uso, ningún sensor encontrado, actualización en curso); y una fila para
  cada uno de: sensor (modelo, automático o manual, antigüedad y valores de la
  última lectura), Wi-Fi (red, señal, IP, AP encendido/apagado), MQTT
  (conectado, mTLS o TCP, identidad) y memoria libre, con un punto verde /
  rojo / gris. Los detalles están en las otras pestañas: Wi-Fi (estado, IP,
  señal, AP con "Desactivar punto de acceso", buscar/conectar/olvidar), MQTT
  (conexión, broker, último evento y error, identidad, configuración del
  broker, subida de certificados), Dispositivo (serial, sensor en uso, chip
  I2C con la advertencia de discrepancia, modelo de sensor, "Detectar de
  nuevo"), Firmware (versión en ejecución y ranura, la otra ranura,
  buscar / actualizar / cambiar, progreso) y Seguridad (contraseña, reinicio,
  reset de fábrica).
- El reset de fábrica (botón o web) borra la red Wi-Fi, la configuración del
  broker MQTT, la configuración del sensor y la contraseña web, y restaura el
  serial, los certificados, el indicador de TLS y el broker y el sensor
  provisionados desde la copia NVS `factory` (sin sensor provisionado: `auto`,
  que se vuelve a detectar).
- LED de estado (GPIO2): parpadeo rápido = AP activo; fijo = MQTT conectado;
  parpadeo lento = Wi-Fi conectado, MQTT todavía no; destello corto cada 2 s =
  sin conexión. Mientras se mantiene BOOT: fijo desde los 3 s (soltar para
  alternar el AP), parpadeo muy rápido una vez que se dispara el reset de
  fábrica.

## Tests en el host

La lógica pura (reglas de sensores, configuración del sensor y decisión de
autodetección, payloads, botón BOOT, alternativa de hora, configuración MQTT,
reglas OTA (actualizaciones iniciadas por la plataforma y por el dispositivo,
cambio de ranura), archivos de provisión) se prueba en la PC, sin placa.
cJSON se toma de `managed_components/` (ejecutá `idf.py build` una vez):

```sh
cmake -S esp32/tests -B /tmp/ceiot-fw-tests
cmake --build /tmp/ceiot-fw-tests
(cd /tmp/ceiot-fw-tests && ctest --output-on-failure)
```
