# Seguridad MQTT: mTLS con PKI propia

## Resumen

El broker (EMQX) ya no acepta conexiones anónimas ni usa las certificados de
DVEM. Ahora:

- **Dispositivos** (ESP32) se autentican por **mTLS**: presentan un
  certificado cliente propio (`CN=<serial>`) firmado por la CA del proyecto,
  sin usuario/contraseña. El broker toma el CN del certificado como username
  MQTT y el ACL restringe a cada dispositivo a su propio árbol de tópicos
  `iot/devices/<serial>/#`.
- **Backend y mqtt-runtime** se autentican con usuario/contraseña (base de
  datos integrada de EMQX) sobre la red interna de Docker, con acceso
  completo (`iot/#`).
- Cualquier otra conexión (anónima, sin certificado, con certificado pero
  fuera de su árbol de tópicos) es rechazada.

```
                    ┌────────────────────────────┐
   ESP32 (mTLS,     │           EMQX              │   backend / mqtt-runtime
   cert CN=serial)  │  TCP :1883  (usuario+clave) │◄──(usuario+clave interno)
   ───────────8883──┤  SSL :8883  (mTLS, sin clave)│
                     │  ACL: iot/devices/<CN>/#    │
                     └────────────────────────────┘
```

## Qué certificado es cada uno

| Archivo | Quién lo tiene | Para qué |
|---|---|---|
| `mqtt/pki/ca/ca.key` | Solo quien emite certificados (nunca el backend) | Firma certificados nuevos. **Nunca sale de este equipo / respaldo offline.** |
| `mqtt/pki/ca/ca.crt` | Broker y todos los dispositivos | Verificar que un certificado fue firmado por la CA del proyecto. |
| `mqtt/certs/emqx.crt` + `emqx.key` | El broker (EMQX) | Certificado de servidor TLS (SANs: `emqx`, `localhost`, `127.0.0.1`, y opcionalmente un hostname público). |
| `mqtt/pki/devices/<SERIAL>/client.crt` + `client.key` + `root.crt` | El dispositivo (se copian a `/littlefs`) | Certificado cliente para mTLS; `root.crt` es una copia de `ca.crt` para que el firmware verifique al broker. |

## Paso a paso

### 1. Crear la CA (una sola vez por proyecto)

```bash
cd mqtt/pki
./crear-ca.sh
```

Genera `mqtt/pki/ca/ca.key` (privada, permisos 600) y `ca.crt`. **Guarde
`ca.key` fuera de este repositorio** (gestor de secretos, pendrive cifrado,
etc.); si se pierde no se pueden emitir certificados nuevos, y si se filtra,
cualquiera puede hacerse pasar por el broker o por cualquier dispositivo.

Para regenerarla (invalida TODOS los certificados ya emitidos):

```bash
./crear-ca.sh --force
```

### 2. Emitir el certificado del broker

```bash
./emitir-certificado-broker.sh [hostname-publico-opcional]
```

Instala directamente `emqx.crt`, `emqx.key` y `ca.crt` en `mqtt/certs/`
(leído por el contenedor `emqx`). Incluye SANs de desarrollo (`emqx`,
`localhost`, `127.0.0.1`); pase un hostname como argumento para producción
(por ejemplo `mqtt.miproyecto.com`).

Recree el contenedor para que tome el certificado nuevo:

```bash
docker compose up -d emqx
```

### 3. Emitir un certificado de dispositivo

```bash
./emitir-certificado-dispositivo.sh IOT-DEM0-0001
```

Crea `mqtt/pki/devices/IOT-DEM0-0001/{client.crt,client.key,root.crt}`. Copie
esos tres archivos a `/littlefs` en el firmware (mismos nombres que ya usa
`esp32/main/mqtt/mqtt_manager.c`: `client.crt`, `client.key` y el CA raíz
como `root.crt`). El firmware ya soporta TLS con verificación de CA y
certificado de cliente; no requiere cambios de código, solo los archivos en
`/littlefs`.

El script rechaza reemitir si ya existe un directorio de salida para ese
serial (evita sobrescribir sin querer); elimine el directorio o indique otro
si necesita reemitir (por ejemplo, tras una rotación).

### 4. Configurar las credenciales del backend

`backend` y `mqtt-runtime` comparten un único usuario MQTT
(`backend-services`) con acceso completo (`iot/#`). La contraseña se define
**una sola vez**, en `mqtt/.env`, y ambos servicios la toman automáticamente
desde ahí (no hace falta repetirla en `backend/.env`).

Agregue a `mqtt/.env` (no se commitea; ver `mqtt/.env.example` para el
nombre de la variable):

```
# Generar con: openssl rand -hex 32
EMQX_BACKEND_PASSWORD="<valor generado>"
```

Sin esta variable, `docker compose` falla explícitamente en vez de arrancar
con un valor por defecto inseguro.

Luego recree el broker y los servicios del backend:

```bash
docker compose up -d emqx
docker compose build backend mqtt-runtime
MAIL_TRANSPORT=mailpit docker compose up -d backend mqtt-runtime
```

La API de administración de EMQX (presencia de dispositivos, `EMQX_API_KEY`
/ `EMQX_API_SECRET`) no cambia: sigue siendo HTTP contra el dashboard/API
(puerto 18083) y es independiente de la autenticación MQTT.

## Cómo está configurado el broker (EMQX)

Ver `mqtt/docker-compose.yml`, `mqtt/acl.conf` y
`mqtt/docker-entrypoint-wrapper.sh`.

- **Listener SSL (8883)**: `verify_peer` + `fail_if_no_peer_cert` (certificado
  de cliente obligatorio) y `peer_cert_as_username = cn` (el username MQTT
  efectivo es el CN del certificado). Se configuró `enable_authn = false`
  **solo en este listener**: la identidad ya quedó probada por el propio TLS
  mutuo, así que no se le exige además un usuario/contraseña — los
  dispositivos no manejan ninguna contraseña.
- **Listener TCP (1883) y WS (8083)**: usan la cadena de autenticación por
  defecto (`password_based` + `built_in_database`), así que cualquier
  conexión sin usuario/contraseña válido (incluida una anónima) es
  rechazada. El listener WS queda habilitado pero autenticado (útil para
  depuración desde un cliente MQTT-sobre-WebSocket con las mismas
  credenciales del backend); no se dejó anónimo en ningún listener.
- **Usuario `backend-services`**: se crea de forma reproducible al arrancar
  el contenedor mediante un archivo de *bootstrap* de la base de datos
  integrada de EMQX (`bootstrap_type = plain`). Ese archivo lo genera
  `mqtt/docker-entrypoint-wrapper.sh` a partir de `EMQX_BACKEND_PASSWORD` en
  un directorio **dentro del contenedor** (`/tmp/emqx-bootstrap`, no
  montado desde el host), así la contraseña en texto plano nunca toca el
  disco del host; EMQX la hashea al cargarla y solo el hash queda
  persistido en `mqtt/data/mnesia` (ya ignorado por git).
  - Si cambia `EMQX_BACKEND_PASSWORD` y recrea el broker, EMQX detecta que
    el usuario ya existe y **no** sobreescribe la contraseña (solo deja un
    warning en el log). Para rotarla: elimine el usuario desde el
    dashboard/API (`DELETE /api/v5/authentication/password_based:built_in_database/users/backend-services`)
    o borre `mqtt/data/mnesia` (reinicia toda la base de auth) y vuelva a
    levantar el broker.
- **ACL** (`mqtt/acl.conf`, formato "rich rule" de EMQX, evaluado en orden):
  1. `backend-services` → acceso total a `iot/#`.
  2. Cualquiera → deniega suscripción a `$SYS/#` y al wildcard global `#`.
  3. Cualquiera → permite `iot/devices/${username}/#` (para un dispositivo,
     `${username}` es el CN de su certificado, es decir su serial).
  4. Cualquier otro caso → denegado.

  `authorization.no_match = deny` es una segunda red de seguridad por si
  ninguna regla matchea.

## Rotación y revocación

No hay CRL/OCSP (fuera de alcance de esta primera versión); el procedimiento
es manual:

- **Rotar el certificado de un dispositivo** (por ejemplo, vence pronto o se
  sospecha que se filtró la clave privada): elimine
  `mqtt/pki/devices/<SERIAL>/` y vuelva a correr
  `emitir-certificado-dispositivo.sh <SERIAL>`; cargue los archivos nuevos en
  el dispositivo. El certificado viejo sigue siendo técnicamente válido para
  la CA hasta que expire — para invalidarlo antes de esa fecha hace falta
  CRL/OCSP (trabajo futuro) o rotar la CA (afecta a todos los dispositivos).
- **Revocar un dispositivo comprometido de forma inmediata**: como no hay
  CRL, la única forma de cortarle el acceso ya mismo es agregar una regla de
  `deny` explícita para ese CN al principio de `mqtt/acl.conf` (antes de la
  regla genérica `iot/devices/${username}/#`) y recargar el broker; el
  certificado sigue siendo válido criptográficamente, pero el ACL le niega
  todo.
- **Rotar la CA**: `./crear-ca.sh --force`, luego reemita el certificado del
  broker y el de **todos** los dispositivos activos (invalida los
  anteriores). Es una operación disruptiva; planifíquela con ventana de
  mantenimiento.
- **Rotar la contraseña de `backend-services`**: ver el punto anterior sobre
  el bootstrap; cambie `EMQX_BACKEND_PASSWORD` en `mqtt/.env` y elimine el
  usuario existente (dashboard/API o `mqtt/data/mnesia`) antes de recrear el
  broker.

## Troubleshooting

- **`SSL: TLSV13_ALERT_CERTIFICATE_REQUIRED` / la conexión TLS se cierra sin
  handshake completo**: el dispositivo no está presentando un certificado de
  cliente. Verifique que `/littlefs` tenga `client.crt` y `client.key` y que
  el firmware los esté cargando.
- **`unknown ca` / error de verificación de la cadena**: el dispositivo (o el
  broker) está validando contra una CA distinta a la que firmó el
  certificado del otro lado. Confirme que `root.crt` en el dispositivo sea
  exactamente el mismo `ca.crt` que está en `mqtt/certs/ca.crt` (regenere
  ambos desde la misma CA si no coinciden).
- **Error de hostname / SAN mismatch**: el hostname al que se conecta el
  cliente no está en los SAN del certificado del broker. Reemita el
  certificado del broker con `./emitir-certificado-broker.sh <hostname>`
  incluyendo ese hostname.
- **El certificado "parece" inválido por fecha (`certificate has expired`/`not yet valid`) aunque las fechas son correctas**:
  con `CONFIG_MBEDTLS_HAVE_TIME_DATE` deshabilitado (el valor por defecto en
  ESP-IDF), mbedTLS **no** valida las fechas del certificado, así que este
  error no debería aparecer con la configuración actual del firmware. Si en
  el futuro se habilita esa opción, el ESP32 necesita conocer la hora real
  antes del handshake TLS: el orden es NTP → `GET /api/public/time` (HTTP
  plano, sin TLS, ver más abajo) → recién ahí MQTT sobre TLS. El *fallback*
  de hora por MQTT (`backend/docs/mqtt-time-sync.md`,
  `iot/devices/{serial}/time/request`) sigue existiendo, pero depende de una
  conexión MQTT ya establecida, así que no sirve para el primer handshake
  TLS — para eso está el bootstrap por HTTP.
- **El backend/mqtt-runtime no conectan (`MQTT Connection failed`)**:
  confirme que `EMQX_BACKEND_PASSWORD` esté definida en `mqtt/.env` y que el
  contenedor `emqx` esté sano (`docker compose ps emqx`); revise
  `docker compose logs emqx` por el warning de bootstrap si cambió la
  contraseña sin borrar el usuario existente.

## Hora del dispositivo (bootstrap antes de mTLS)

El ESP32 necesita una hora razonable antes de poder validar el certificado
del broker (si `CONFIG_MBEDTLS_HAVE_TIME_DATE` está habilitado). Orden de
arranque:

1. **NTP** (SNTP), siempre primero.
2. **HTTP**: `GET /api/public/time` en el backend — sin autenticación, sin
   TLS a propósito (todavía no hay hora para validar el certificado del
   broker). Debe seguir siendo alcanzable por HTTP plano en producción (ver
   nota de reverse proxy en `backend/docs/mqtt-time-sync.md`).
3. **MQTT sobre TLS**: una vez conectado, `iot/devices/{serial}/time/request`
   sigue disponible como fallback/resincronización sin reconectar SNTP.

Contrato completo (payloads, ejemplos, ACL) en
`backend/docs/mqtt-time-sync.md`.

## CLI de emulación (`tools/emulador-dispositivo.py`)

Para desarrollar o hacer una demo sin hardware real, pero ejercitando el
camino seguro completo (mTLS -> broker -> `mqtt-runtime` -> validación ->
DB), hay un script Python que se conecta con el certificado de cliente real
de un dispositivo, igual que lo haría el firmware.

### Requisitos

- Un certificado de dispositivo ya emitido en `mqtt/pki/devices/<serial>/`
  (`client.crt`, `client.key`, `root.crt`) — ver "Emitir un certificado de
  dispositivo" más arriba si todavía no existe.
- `paho-mqtt` instalado. Dos formas:

**Opción A — venv en el host:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install paho-mqtt==2.1.0
python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001
```

**Opción B — dentro del contenedor backend** (ya tiene `paho-mqtt`):

```bash
docker compose cp tools/emulador-dispositivo.py backend:/tmp/emulador-dispositivo.py
docker compose cp mqtt/pki/devices/IOT-DEM0-0001 backend:/tmp/IOT-DEM0-0001
docker compose exec backend python3 /tmp/emulador-dispositivo.py \
  --serial IOT-DEM0-0001 --cert-dir /tmp/IOT-DEM0-0001 --host emqx --port 8883
```

(Dentro de la red de Docker el broker se alcanza como `emqx:8883`; desde el
host se usa `localhost:18883`, el puerto TLS publicado por
`mqtt/docker-compose.yml`.)

### Uso

**Importante:** `--sensors` tiene que usar la(s) `key` de sensor realmente
instalada(s) en ese dispositivo (`GET /api/devices/{id}/sensors` te la da; el
default del script, `dht22:temperature,relative_humidity`, es solo un
ejemplo — si el dispositivo tiene instalado `dht11` en vez de `dht22`, o una
`key` distinta como `dht22_2`, las lecturas publicadas con la clave
equivocada se descartan silenciosamente en la ingesta, igual que pasaría con
un dispositivo real; revisá los logs de `mqtt-runtime` si no ves filas
nuevas en `telemetry`).

```bash
# Una lectura con los sensores por defecto (dht22: temperatura + humedad) —
# ajustá --sensors si el dispositivo tiene otra key instalada
python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001

# Tres lecturas cada 5s, especificando sensores instalados
python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001 \
  --sensors "dht11:temperature,relative_humidity" --count 3 --interval 5

# Varios sensores instalados (separados por ';')
python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0003 \
  --sensors "dht22:temperature,relative_humidity;bmp280:temperature,pressure"

# Pedir la hora por MQTT y esperar la respuesta
python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001 --pedir-hora
```

Valores publicados con un *random walk* pequeño y acotado a rangos
realistas por variable (mismos rangos que el catálogo de sensores:
temperatura 18-28°C, humedad 35-65%, presión 995-1025hPa por defecto).

Argumentos: `--serial` (obligatorio), `--cert-dir` (default
`mqtt/pki/devices/<serial>/`), `--host` (default `localhost`), `--port`
(default `18883`), `--interval`, `--count`, `--sensors`, `--pedir-hora`. Ver
`python3 tools/emulador-dispositivo.py --help` para el detalle completo.

**Nota sobre el hostname del certificado del broker:** los SAN del
certificado de EMQX son `emqx`, `localhost` y `127.0.0.1`. Conectate con
`--host localhost` (desde el host) o `--host emqx` (desde otro contenedor de
la misma red) para que la verificación de hostname TLS funcione; cualquier
otro hostname/IP requiere reemitir el certificado del broker con ese SAN
(`./emitir-certificado-broker.sh <hostname>`).

## Qué nunca se sube a git

Todo lo siguiente está en `.gitignore` y no debe commitearse jamás:

- `mqtt/pki/ca/` (la clave privada de la CA)
- `mqtt/pki/devices/` (claves privadas de cada dispositivo)
- `mqtt/certs/` (certificado y clave privada del broker)
- `esp32/cert/` (certificado y clave privada del dispositivo de desarrollo)
- Cualquier `*.key`, `*.pem`, `*.crt`, `*.csr`, `*.srl`
- `mqtt/.env` (contiene `EMQX_PASSWORD` y `EMQX_BACKEND_PASSWORD`)

Ver también `backend/docs/mqtt-time-sync.md` para el contrato de
sincronización de hora por MQTT (independiente de mTLS, pero relevante para
el mismo firmware).
