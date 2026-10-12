# Levantá la plataforma de monitoreo ambiental en tu máquina

El Docker Compose de la raíz levanta el backend (API y `mqtt-runtime`), el
frontend, la landing, TimescaleDB, EMQX, Redis, SeaweedFS, Mailpit y las
herramientas de desarrollo (pgAdmin y RedisInsight) en una misma red privada de
Docker. Los puertos publicados son accesibles únicamente desde tu máquina, a
través de la interfaz local.

## Arranque

Seguí estos pasos en orden la primera vez que levantás el proyecto en una
máquina. Todos los comandos se ejecutan desde la raíz del repositorio.

### 1. Requisitos

- Docker con el plugin Compose **2.24 o superior** (`docker compose version`).
  El `docker-compose.yml` de la raíz usa `include` con `env_file` por
  componente y archivos `env_file` opcionales (`required: false`).
- `bash` y `openssl`, para los scripts y la PKI del broker.
- Python 3.10 o superior, solo si vas a aprovisionar dispositivos
  ([`provisioning/README.md`](provisioning/README.md)) o usar el emulador.
- ESP-IDF 6.1, solo para compilar y grabar el firmware
  ([`esp32/README.md`](esp32/README.md)).

### 2. Archivos de configuración

Cada componente mantiene su configuración en su propio `.env`, que no se
versiona. Creálos a partir de las plantillas:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp landing/.env.example landing/.env
cp timescaledb/.env.example timescaledb/.env
cp mqtt/.env.example mqtt/.env
# Opcionales
cp seaweedfs/.env.example seaweedfs/.env   # módulo Documentos (S3)
cp pgadmin/.env.example pgadmin/.env       # login de pgAdmin
```

`scripts/levantar.sh` no crea estos archivos: si falta alguno de los cinco
obligatorios, se detiene e indica el `cp` correspondiente.

Las plantillas usan los puertos estándar y marcan con `CAMBIAR_` los valores
que tenés que elegir. Generá cada secreto con `openssl` y reemplazá el valor:

| Archivo | Variable | Cómo generarla |
| --- | --- | --- |
| `timescaledb/.env` | `DB_PASSWORD` | `openssl rand -hex 24` |
| `mqtt/.env` | `EMQX_PASSWORD`, `EMQX_BACKEND_PASSWORD` | `openssl rand -hex 32` (una para cada una) |
| `backend/.env` | `JWT_SECRET_KEY` | `openssl rand -hex 32` |
| `backend/.env` | `BOOTSTRAP_ADMIN_PASSWORD` | Elegida por vos: al menos 8 caracteres, con mayúscula, minúscula y número |
| `seaweedfs/.env` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `openssl rand -hex 12` y `openssl rand -hex 32` |
| `pgadmin/.env` | `PGADMIN_DEFAULT_PASSWORD` | `openssl rand -hex 16` |

Las claves de Google Maps (`VITE_GCP_API_KEY` en `frontend/.env` y
`PUBLIC_GCP_MAPS_API_KEY` en `landing/.env`) son opcionales: sin una clave
válida la aplicación funciona, pero los mapas no cargan.

`backend/.env` trae `MAIL_TRANSPORT=mailpit`: los correos quedan en Mailpit y
nunca se entregan. Para entrega real, ver
[Captura local de correos con Mailpit](#captura-local-de-correos-con-mailpit).

### 3. Certificados del broker MQTT

EMQX exige mTLS en el puerto de los dispositivos, así que el stack no arranca
sin la CA del proyecto y el certificado del broker. Ningún certificado ni
clave se versiona; las carpetas `mqtt/certs/` y `esp32/cert/` solo contienen
archivos `*.example` que muestran qué va en cada lugar.

```bash
mqtt/pki/crear-ca.sh                    # CA del proyecto (una sola vez)
mqtt/pki/emitir-certificado-broker.sh   # instala ca.crt, emqx.crt y emqx.key en mqtt/certs/
```

La guía completa, con dispositivos reales en la red local, está en
[`docs/certificados-mqtt.md`](docs/certificados-mqtt.md).

### 4. Levantar el stack

```bash
scripts/levantar.sh --build
```

El script:

1. Verifica la versión de Compose, los archivos `.env` y los certificados del
   broker.
2. Crea las carpetas de datos montadas (`mqtt/data`, `mqtt/log`, `redis/data`,
   `seaweedfs/data`). EMQX corre con el uid 1000 dentro del contenedor: si
   `mqtt/data` o `mqtt/log` pertenecen a otro usuario, avisa y sugiere
   `sudo chown -R 1000:1000 mqtt/data mqtt/log`.
3. Arranca PostgreSQL, espera a que esté sano y aplica las migraciones
   (`alembic upgrade head`) en un contenedor descartable del backend. En una
   base vacía crean el esquema y los catálogos iniciales: los tipos de
   dispositivo ("Ambiental" y "1 Relé"), los sensores y las variables. Si la base ya está
   al día, no hacen nada.
4. Levanta el resto del stack con los correos redirigidos a Mailpit (perfil
   `local-mail`), incluidos pgAdmin y RedisInsight. Solo crea el contenedor de
   embeddings locales si `backend/.env` tiene `EMBEDDING_PROVIDER=local` (si
   no, lo elimina).

Sin `--build` levanta sin reconstruir las imágenes; con `--dry-run` muestra
los comandos sin ejecutarlos. Volvé a usar `--build` cada vez que cambies una
variable `VITE_*` o `PUBLIC_*`: se incorporan a las imágenes del frontend y de
la landing durante la compilación.

### 5. Primer inicio de sesión

Con la base vacía, el backend crea el primer administrador a partir de
`BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y
`BOOTSTRAP_ADMIN_PASSWORD` de `backend/.env`; si falta alguno, el backend no
arranca. Ingresá en <http://localhost:5173> con ese usuario y cambiá la
contraseña desde el perfil. El backend nunca modifica administradores
existentes, así que después del primer arranque esas variables ya no se usan.

Después, desde la administración, cargá los catálogos que dependen de tu
instalación (países, provincias y ciudades, tipos de ambiente) y creá los
ambientes.

### 6. Dispositivos

- Para dar de alta y grabar un ESP32 real (serial, certificado, perfil del
  broker y sensor), seguí [`provisioning/README.md`](provisioning/README.md).
  Requiere configurar el acceso desde la red local (ver
  [Acceso desde la red local](#acceso-desde-la-red-local-dispositivos-reales)).
- Para compilar el firmware, ver [`esp32/README.md`](esp32/README.md).
- Para probar sin hardware, el emulador `tools/emulador-dispositivo.py` se
  conecta con el certificado de un dispositivo igual que el firmware (ver la
  sección "CLI de emulación" de [`mqtt/README.md`](mqtt/README.md)).

## Configuración y puertos

| Servicio | URL o puerto en tu máquina | Variable | Destino dentro de Docker |
| --- | --- | --- | --- |
| Frontend | <http://localhost:5173> | `VITE_FRONTEND_PORT` (`frontend/.env`) | `frontend:80` |
| Landing | <http://localhost:4321> | `LANDING_PORT` (`landing/.env`) | `landing:80` |
| API del backend | <http://localhost:8000/api> | `BACKEND_PORT` (`backend/.env`) | `backend:8000` |
| PostgreSQL | `5432` | `DB_PORT` (`timescaledb/.env`) | `postgresql:5432` |
| MQTT TCP | `1883` | `MQTT_LISTENER_TCP` (`mqtt/.env`) | `emqx:1883` |
| MQTT TLS (mTLS) | `8883` | `MQTT_LISTENER_TLS` (`mqtt/.env`) | `emqx:8883` |
| MQTT WebSocket | `8083` | `MQTT_LISTENER_WS` (`mqtt/.env`) | `emqx:8083` |
| Panel de EMQX | <http://localhost:28183> | `EMQX_DASHBOARD_PORT` (`mqtt/.env`, opcional) | `emqx:18083` |
| Mailpit | <http://localhost:8025> | `MAILPIT_UI_PORT` | `mailpit:8025` |
| pgAdmin | <http://localhost:15050> (login en `pgadmin/.env`) | `PGADMIN_PORT` | `pgadmin:80` |
| RedisInsight | <http://localhost:15540> | `REDISINSIGHT_PORT` | `redisinsight:5540` |

Para comprobar el estado del backend, usá <http://localhost:8000/health>. La
documentación interactiva de la API está en <http://localhost:8000/api/docs>
(deshabilitada con `ENVIRONMENT=PROD`). Redis y SeaweedFS no publican puertos: solo se
alcanzan dentro de la red de Docker.

Si un puerto ya está ocupado en tu máquina, cambiá la variable de la tabla:

- Para los servicios con archivo indicado, editá ese `.env`. Si cambiás
  `BACKEND_PORT`, `VITE_FRONTEND_PORT` o `LANDING_PORT`, actualizá también las
  URLs que los usan (`VITE_*` en `frontend/.env`, `PUBLIC_*` en `landing/.env`,
  `BACKEND_CORS_ORIGINS` y `VITE_FRONTEND_PORT` en `backend/.env`) y
  reconstruí con `scripts/levantar.sh --build`.
- `MAILPIT_UI_PORT`, `PGADMIN_PORT` y `REDISINSIGHT_PORT` se leen de las
  variables de entorno de la shell o de un archivo `.env` en la raíz del
  repositorio (ignorado por Git), por ejemplo `PGADMIN_PORT=25050`.

Los contenedores se conectan a `postgresql:5432` y `emqx:1883`; los puertos
publicados se usan solamente para conectarte desde tu máquina. Compose arma las
URLs de conexión del backend a partir de las credenciales de `timescaledb/.env`
y siempre utiliza `postgresql:5432`. La variable `DB_PORT` controla únicamente
el puerto publicado en tu máquina.

`frontend/.env` alimenta la imagen de Docker. `npm run dev` fuera de Docker no
lo lee: Vite toma las variables del `.env` de la raíz del repositorio
(`envDir: ".."` en `frontend/vite.config.ts`).

Que los puertos MQTT estén publicados y el contenedor esté saludable no confirma
la autenticación de los clientes, la validez de la cadena de confianza TLS ni el
funcionamiento de los clientes WebSocket. La contraseña configurada para EMQX
corresponde a su panel de administración de desarrollo: no crea un usuario para
las conexiones MQTT de la aplicación.

## Acceso desde la red local (dispositivos reales)

Por defecto todos los puertos se publican solo en `127.0.0.1`. Para que un
ESP32 real conectado a la misma red local llegue al stack, se exponen
únicamente dos puertos en la IP de la máquina:

- el puerto MQTT TLS (`MQTT_LISTENER_TLS`, autenticación por certificado de
  cliente), y
- el puerto HTTP del backend (`BACKEND_PORT`), desde el que el dispositivo
  descarga las imágenes de firmware (OTA).

El puerto MQTT TCP sin cifrar, el WebSocket, el panel de EMQX, PostgreSQL,
pgAdmin y Redis siguen disponibles solo en `127.0.0.1`.

Pasos:

1. Defina la IP de la máquina en la red local (por ejemplo `192.168.1.50`) en
   `mqtt/.env` y en `backend/.env`:

   ```dotenv
   LAN_BIND_IP=192.168.1.50
   ```

2. En `backend/.env`, indique la base de la URL de descarga que recibirán los
   dispositivos, con el puerto publicado del backend, y agregue esa IP a los
   hosts confiables:

   ```dotenv
   FIRMWARE_DOWNLOAD_BASE_URL=http://192.168.1.50:8000
   BACKEND_TRUSTED_HOSTS=["localhost","127.0.0.1","backend","192.168.1.50"]
   ```

3. Reemita el certificado del broker para que incluya esa IP (los
   dispositivos validan el certificado contra la dirección a la que se
   conectan) y recree `emqx`:

   ```bash
   mqtt/pki/emitir-certificado-broker.sh
   ```

   Sin argumentos toma `LAN_BIND_IP` de `mqtt/.env`. El paso a paso completo
   está en [`mqtt/README.md`](mqtt/README.md) (sección "Con la IP de la red local").

4. Recree los servicios para aplicar los cambios:

   ```bash
   MAIL_TRANSPORT=mailpit docker compose up -d emqx backend mqtt-runtime
   ```

Para dar de alta y grabar un ESP32 (serial, certificado, perfil del broker y
variante de sensor) siga [`provisioning/README.md`](provisioning/README.md).

La descarga por HTTP sin cifrar se acepta solo en desarrollo: la orden de
actualización llega por MQTT con TLS mutuo e incluye el SHA-256 y el tamaño de
la imagen, que el dispositivo verifica antes de instalarla. En producción, la
URL de descarga debe ser HTTPS. Si la IP de la máquina cambia, repita los
pasos 1 a 4.

## Captura local de correos con Mailpit

Mailpit captura mensajes dentro de Docker para inspeccionarlos durante el desarrollo; **no los entrega a casillas reales**. El perfil y el transporte son decisiones separadas y explícitas:

- `scripts/levantar.sh` activa el perfil `local-mail` (que crea el contenedor `mailpit`) y exporta `MAIL_TRANSPORT=mailpit`.
- `backend/.env` trae `MAIL_TRANSPORT=mailpit` en la plantilla, así que un `docker compose up` manual también usa Mailpit. Para entrega real, cambiá a `MAIL_TRANSPORT=smtp` y completá `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` y `MAIL_FROM` (ver [`backend/README.md`](backend/README.md)).

Para iniciar Mailpit sin el script:

```bash
docker compose --profile local-mail up -d
```

La UI queda disponible sólo en <http://127.0.0.1:8025> (`MAILPIT_UI_PORT`). El puerto SMTP `1025` no se publica en el host y Mailpit no tiene relay ni reenvío configurado. Activar el perfil por sí solo no cambia el backend: `MAIL_TRANSPORT=mailpit` hace que use exclusivamente `mailpit:1025`; `MAIL_TRANSPORT=smtp` (valor predeterminado del backend si la variable falta) conserva la entrega real configurada.

Para que la landing en <http://localhost:4321> llame al contacto público, el operador debe incluir ese origen exacto en `BACKEND_CORS_ORIGINS` (la plantilla ya lo incluye) y mantener `BACKEND_TRUSTED_HOSTS` acorde a los hosts reales. Esas listas no se reemplazan automáticamente. El límite actual del contacto vive en memoria de cada proceso y la IP reenviada no se considera confiable sin una política de proxy; no alcanza por sí solo como protección para exponer el endpoint en producción.

## Base de datos en desarrollo

El proyecto raíz crea un volumen con nombre para PostgreSQL si todavía no existe.
Las credenciales de `timescaledb/.env` se aplican solo al crear ese volumen.
El esquema se administra exclusivamente con Alembic: `scripts/levantar.sh`
ejecuta `alembic upgrade head` antes de iniciar el backend. Si levantás el
stack de otra forma, aplicá las migraciones primero:

```bash
docker compose up -d --wait postgresql
docker compose run --rm --no-deps backend alembic upgrade head
```

El arranque sólo crea un administrador cuando todavía no existe ninguno y el
operador configuró `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y
`BOOTSTRAP_ADMIN_PASSWORD`; nunca reemplaza administradores existentes.

## Backups

`scripts/backup.sh` respalda la base (dump consistente con `pg_dump` sobre un
snapshot exportado), los roles (sin contraseñas) y los objetos S3 de
documentos y firmware, y al terminar verifica el resultado restaurándolo en un
contenedor PostgreSQL descartable, con la misma imagen y sin red:

```bash
scripts/backup.sh                              # backup + verificación
scripts/verificar-backup.sh backups/<fecha>    # volver a verificar uno existente
```

Cada backup queda en `backups/<fecha UTC>/` (ignorado por git) con el dump,
`manifest.json` (conteos exactos, huellas de contenido, hypertables, políticas
RLS, roles, versiones de Alembic y de las extensiones) y `SHA256SUMS`. La
verificación termina con `✅ Backup verificado` (código 0) sólo si el dump se
restaura sin errores, la base restaurada coincide exactamente con el manifiesto
y cada objeto S3 conserva su sha256; si no, informa `❌ Backup inválido` con
los motivos (código 1). El backup sólo lee la base real.

Para que corra solo todos los días, se programa en el crontab del usuario del
host:

```bash
scripts/instalar-backup-cron.sh instalar --hora 03:00 --conservar 7   # programar
scripts/instalar-backup-cron.sh estado                                # línea instalada y último resultado
scripts/instalar-backup-cron.sh quitar                                # desprogramar
```

Cada ejecución deja su log en `backups/logs/` y el resultado en
`backups/ultimo-resultado.json`, conserva los 7 backups verificados más
recientes y, si falla, envía un aviso con el mailer de la aplicación (en
desarrollo llega a Mailpit, <http://localhost:8025>) a `BACKUP_NOTIFY_EMAIL` o
al primer administrador activo.

El detalle de lo que se verifica, las opciones, la programación, la retención,
las limitaciones y los pasos para restaurar en la base real están en
[`docs/backups.md`](docs/backups.md).

La compresión, la retención y los agregados horarios de la telemetría (y la
limpieza de lecturas y operaciones viejas) se explican en
[`docs/ciclo-de-vida-datos.md`](docs/ciclo-de-vida-datos.md).

## Detener los servicios

Para detener y retirar los contenedores sin borrar los datos de la base, ejecutá:

```bash
docker compose --profile local-mail --profile embeddings-local down
```

**No agregues `--volumes` salvo que quieras borrar los volúmenes y perder los
datos de la base local.** Los datos de EMQX, Redis y SeaweedFS viven en
`mqtt/data`, `redis/data` y `seaweedfs/data`, y `down` no los borra.
