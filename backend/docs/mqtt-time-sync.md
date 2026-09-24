# Sincronización de hora por MQTT (fallback de NTP)

> Ver también [`mqtt/README.md`](../../mqtt/README.md) para la seguridad del
> broker (mTLS, PKI propia, credenciales del backend), incluida la nota sobre
> `CONFIG_MBEDTLS_HAVE_TIME_DATE` y este mismo mecanismo de hora.

## Por qué existe

El firmware del ESP32 intenta obtener la hora por SNTP (`time.google.com`,
`pool.ntp.org`) al conectar la red. En algunas redes (por ejemplo, un hotspot
de iPhone) el tráfico NTP (UDP/123) queda bloqueado por el operador o por el
propio hotspot, aunque la conexión MQTT sobre TCP/TLS funcione con
normalidad. Además, el broker exige mTLS: sin una hora razonablemente
correcta el propio ESP32 puede rechazar el certificado del broker por
considerarlo "no vigente todavía" o "expirado". Necesitamos entonces una
hora aproximada *antes* de poder conectar por MQTT/TLS.

**No reemplaza a NTP.** Es un *fallback*: seguí intentando SNTP primero y
usá este camino solo si no obtuviste hora por NTP en un tiempo razonable.

## Orden de arranque del firmware

1. **NTP (SNTP)** — primer intento, siempre. Es la fuente de hora estándar y
   no depende de nuestra infraestructura.
2. **HTTP** (`GET /api/public/time`, ver abajo) — si SNTP no sincronizó en un
   timeout razonable y `CONFIG_MBEDTLS_HAVE_TIME_DATE` está habilitado en el
   `sdkconfig` del proyecto (mbedTLS necesita saber la hora para validar
   certificados; si esa opción está deshabilitada, mbedTLS no usa el reloj
   del sistema para validar vigencia y este paso pierde sentido). Es HTTP
   plano (sin TLS) a propósito: todavía no tenemos hora para validar el
   certificado del broker MQTT, así que no podemos exigir TLS acá tampoco.
3. **MQTT sobre TLS** — una vez que el reloj tiene una hora razonable (por
   NTP o por HTTP), conectá al broker EMQX (mTLS, puerto 8883). El fallback
   de hora por MQTT (`iot/devices/{serial}/time/request`, documentado más
   abajo) sigue disponible después de este punto para resincronizar sin
   reconectar SNTP.

## Bootstrap de hora por HTTP

```
GET /api/public/time
```

Sin autenticación, sin body. Respuesta (`Cache-Control: no-store`):

```json
{ "epoch_ms": 1790262894432, "iso": "2026-09-24T15:14:54.432Z" }
```

- `epoch_ms` / `iso`: mismo formato que la respuesta MQTT de abajo (hora UTC
  del servidor, tomada lo más tarde posible antes de responder).
- Rate-limit liviano por IP (mismo mecanismo que `/api/public/contact`), para
  evitar abuso sin bloquear reintentos normales de arranque.

**Nota de despliegue en producción:** este endpoint debe seguir siendo
alcanzable por **HTTP plano** (no forzado a HTTPS) en el reverse proxy de
producción — es justamente el mecanismo que usa el firmware *antes* de tener
una hora válida para negociar TLS. Si el proxy redirige todo `http://` a
`https://` incondicionalmente, agregá una excepción para esta ruta.

## Cuándo llamarlo

Sugerido: si `esp_sntp_init()` no dejó el reloj sincronizado dentro de un
timeout razonable después de conectar (por ejemplo, 10-15 segundos sin que
`sntp_get_sync_status()` indique `SNTP_SYNC_STATUS_COMPLETED`, o el año del
reloj del sistema sigue siendo el de 1970/reset), publicá una solicitud de
hora por MQTT. No hace falta reintentar en bucle rápido: con que se resuelva
una vez por arranque (o cada tanto si el reloj se desincroniza) alcanza.

## Contrato

### 1. Dispositivo → servidor (solicitud)

```
Topic: iot/devices/{serial}/time/request
QoS:   1
```

Payload (JSON, **opcional** — un payload vacío o inválido también es válido,
simplemente no se hace *eco* de ningún `req_id`):

```json
{ "req_id": "algo-que-elijas-vos" }
```

- `req_id`: string de hasta 64 caracteres. Sirve para que el firmware pueda
  correlacionar la respuesta con la solicitud si maneja varias en paralelo
  (en general no hace falta: alcanza con una solicitud a la vez).

`{serial}` es el mismo identificador de dispositivo (`identity`) que ya usás
para `iot/devices/{serial}/telemetry`, `.../events`, `.../status` y `.../ota`.

### 2. Servidor → dispositivo (respuesta)

```
Topic:  iot/devices/{serial}/time
QoS:    1
Retain: false
```

Payload (JSON):

```json
{ "epoch_ms": 1790262894432, "iso": "2026-09-24T15:14:54.432Z", "req_id": "algo-que-elijas-vos" }
```

- `epoch_ms`: entero, milisegundos desde epoch Unix, hora UTC del servidor,
  tomada lo más tarde posible (justo antes de publicar la respuesta) para
  minimizar el error introducido por la consulta a la base de datos.
- `iso`: la misma hora en formato ISO-8601 UTC con milisegundos y sufijo
  `Z` (ej. `2026-09-24T15:14:54.432Z`). Redundante con `epoch_ms`; usá el
  que te resulte más cómodo de parsear en el firmware.
- `req_id`: el mismo valor recibido en la solicitud, o `null` si la
  solicitud no traía uno (o traía uno inválido).

### Cuándo NO hay respuesta

El servidor **solo responde si el `{serial}` corresponde a un dispositivo
registrado, habilitado y activo** en la base. Si el dispositivo no existe,
está deshabilitado o inactivo, la solicitud se descarta silenciosamente (se
registra en el log del servidor, pero no se publica nada en
`iot/devices/{serial}/time`). Diseñá el firmware para tolerar esto: si no
llega respuesta en un timeout razonable (2-3 segundos son suficientes en la
red local), simplemente reintentá más tarde o seguí sin hora sincronizada.

## Cómo aplicar la hora recibida

1. Al recibir el mensaje en `iot/devices/{serial}/time`, tomá `epoch_ms`.
2. (Opcional, recomendado si te importa la precisión) Si guardaste el
   instante en el que publicaste la solicitud (`t_request`, con
   `esp_timer_get_time()` u otro reloj monotónico local) y el instante en
   el que llegó la respuesta (`t_response`), podés compensar la mitad del
   round-trip:
   `hora_corregida_ms = epoch_ms + (t_response - t_request) / 2`.
   Esto es una aproximación (asume ida y vuelta simétricas) pero mejora la
   precisión sobre no compensar nada. Si no te interesa esa precisión,
   usar `epoch_ms` tal cual es perfectamente válido para esta reconexión.
3. Aplicá la hora al reloj del sistema, igual que lo harías tras una
   sincronización SNTP exitosa (`settimeofday()` con la hora en UTC).

## Ejemplo de intercambio

```
# Dispositivo publica:
iot/devices/IOT-DEM0-0001/time/request
{"req_id": "boot-1"}

# Servidor responde (mqtt-runtime, típicamente <100 ms en red local):
iot/devices/IOT-DEM0-0001/time
{"epoch_ms": 1790262894432, "iso": "2026-09-24T15:14:54.432Z", "req_id": "boot-1"}
```

## Quién procesa esto en el backend

El runtime de ingestión MQTT (`app.main_runtime`, servicio de compose
`mqtt-runtime`) se suscribe a `iot/devices/+/time/request` (QoS 1) igual que
al resto de los topics genéricos de dispositivo. La API pública
(`app.main`, servicio `backend`) sigue siendo publisher-only y no participa
de este intercambio.

## Nota sobre permisos del broker (ACL)

Al revisar la configuración actual de EMQX (vía su API de administración,
`GET /api/v5/authorization/settings` y `/sources`) encontramos que el
broker está usando **la configuración de ejemplo por defecto**, sin
autenticación configurada (`/api/v5/authentication` devuelve una lista
vacía) y con la última regla de autorización siendo `{allow, all}.` (con
`authorization.no_match = allow`) — es decir, hoy **cualquier cliente puede
publicar y suscribirse a cualquier topic**, incluido este nuevo par
`iot/devices/{serial}/time/request` / `.../time`. Los comentarios del
propio archivo de reglas de EMQX lo señalan explícitamente:

> NOTE! when deploy in production: Change the last rule to `{deny, all}.` /
> Set config `authorization.no_match = deny`

Esto significa que **no hace falta ningún cambio de ACL para que este
mecanismo funcione hoy** (ya funciona, ver verificación en vivo más abajo),
pero también que ningún dispositivo está aislado del topic de otro: un
cliente cualquiera podría publicar en el topic de `time/request` de
cualquier serial, o suscribirse a la respuesta de cualquier otro
dispositivo. Esto es un hallazgo preexistente, no introducido por esta
funcionalidad, y no lo modificamos (no nos corresponde debilitar ni
tampoco endurecer la seguridad del broker sin que el equipo lo decida
explícitamente).

Si en el futuro se define una ACL por dispositivo (por ejemplo, atada al
`username`/`clientid` con el que cada ESP32 se autentica), habrá que
agregar explícitamente para cada dispositivo:

- permiso de **publish** en `iot/devices/{su propio serial}/time/request`
- permiso de **subscribe** en `iot/devices/{su propio serial}/time`

y para el cliente del runtime de ingestión (`mqtt-runtime`, hoy
`MQTT_CLIENT_ID=Backend-Runtime`):

- permiso de **subscribe** en `iot/devices/+/time/request` (comodín, todos
  los dispositivos)
- permiso de **publish** en `iot/devices/+/time` (comodín, todos los
  dispositivos)

exactamente en paralelo a los permisos que ya necesitaría para
`.../telemetry`, `.../events` y `.../status`.
