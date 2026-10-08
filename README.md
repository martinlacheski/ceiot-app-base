# Levantá los cinco servicios de la aplicación en tu máquina

El Docker Compose de la raíz levanta el backend, el frontend, la landing,
TimescaleDB y EMQX en una misma red privada de Docker. Los puertos publicados
son accesibles únicamente desde tu máquina, a través de la interfaz local.

## Arranque

Ejecutá este comando desde la raíz del proyecto:

```bash
scripts/levantar.sh --build
```

El script levanta todo el stack con los correos redirigidos a Mailpit, arranca
pgAdmin y RedisInsight, y solo crea el contenedor de embeddings locales si
`backend/.env` tiene `EMBEDDING_PROVIDER=local` (si no, lo elimina). Sin
`--build` levanta sin reconstruir las imágenes; con `--dry-run` muestra los
comandos sin ejecutarlos.

- La landing en: 
<http://localhost:14321>
- El frontend en: 
<http://localhost:15173>
- La API del backend en: 
<http://localhost:18000/api>
- Mailpit en: 
<http://localhost:8025>
- pgAdmin en: 
<http://localhost:15050> (credenciales en `pgadmin/.env`)
- RedisInsight en: 
<http://localhost:15540>

Para comprobar el estado del backend, usá: <http://localhost:18000/health>.

## Configuración y puertos

Cada componente mantiene su configuración en su propio archivo `.env`:
`backend/.env`, `frontend/.env`, `landing/.env`, `timescaledb/.env` y
`mqtt/.env`. No hay un `.env` en la raíz.

| Servicio | Puerto en tu máquina | Destino dentro de Docker |
| --- | ---: | --- |
| Frontend | `15173` | `frontend:80` |
| Landing | `14321` | `landing:80` |
| Backend | `18000` | `backend:8000` |
| PostgreSQL | `15432` | `postgresql:5432` |
| MQTT TCP | `11883` | `emqx:1883` |
| MQTT TLS | `18883` | `emqx:8883` |
| MQTT WebSocket | `28083` | `emqx:8083` |

Los contenedores se conectan a `postgresql:5432` y `emqx:1883`; los puertos
publicados se usan solamente para conectarte desde tu máquina. Compose arma las
URLs de conexión del backend a partir de las credenciales de `timescaledb/.env`
y siempre utiliza `postgresql:5432`. La variable `DB_PORT` controla únicamente
el puerto publicado en tu máquina.

Las URLs `VITE_*` del frontend y `PUBLIC_*` de la landing se incorporan a las
imágenes durante la compilación. Si las cambiás, tenés que reconstruir la imagen
correspondiente; no alcanza con reiniciar el contenedor.

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
   dispositivos, con el puerto publicado del backend:

   ```dotenv
   FIRMWARE_DOWNLOAD_BASE_URL=http://192.168.1.50:18000
   ```

3. Reemita el certificado del broker para que incluya esa IP (los
   dispositivos validan el certificado contra la dirección a la que se
   conectan) y recree `emqx`:

   ```bash
   cd mqtt/pki && ./emitir-certificado-broker.sh
   ```

   Sin argumentos toma `LAN_BIND_IP` de `mqtt/.env`. El paso a paso completo
   está en [`mqtt/README.md`](mqtt/README.md) (sección "Con la IP de la red local").

4. Recree los servicios para aplicar los cambios:

   ```bash
   MAIL_TRANSPORT=mailpit docker compose up -d emqx backend mqtt-runtime
   ```

La descarga por HTTP sin cifrar se acepta solo en desarrollo: la orden de
actualización llega por MQTT con TLS mutuo e incluye el SHA-256 y el tamaño de
la imagen, que el dispositivo verifica antes de instalarla. En producción, la
URL de descarga debe ser HTTPS. Si la IP de la máquina cambia, repita los
pasos 1 a 4.

## Captura local de correos con Mailpit

Mailpit captura mensajes dentro de Docker para inspeccionarlos durante el desarrollo; **no los entrega a casillas reales**. El perfil y el transporte son decisiones separadas y explícitas. Persistí estas variables manualmente en `backend/.env` si querés conservarlas entre comandos:

```dotenv
MAIL_TRANSPORT=mailpit
MAILPIT_UI_PORT=8025
```

Después iniciá Compose con el perfil local:

```bash
docker compose --profile local-mail -p iot-app-base -f docker-compose.yml up -d
```

La UI queda disponible sólo en <http://127.0.0.1:8025>. El puerto SMTP `1025` no se publica en el host y Mailpit no tiene relay ni reenvío configurado. Activar el perfil por sí solo no cambia el backend: `MAIL_TRANSPORT=mailpit` hace que use exclusivamente `mailpit:1025`; `MAIL_TRANSPORT=smtp` (valor predeterminado) conserva la entrega real configurada.

Para que la landing en <http://localhost:14321> llame al contacto público, el operador debe incluir ese origen exacto en `BACKEND_CORS_ORIGINS` y mantener `BACKEND_TRUSTED_HOSTS` acorde a los hosts reales. Esas listas no se reemplazan automáticamente. El límite actual del contacto vive en memoria de cada proceso y la IP reenviada no se considera confiable sin una política de proxy; no alcanza por sí solo como protección para exponer el endpoint en producción.

## Base de datos en desarrollo

El proyecto raíz crea un volumen con nombre para PostgreSQL si todavía no existe.
El esquema se administra exclusivamente con Alembic: ejecutá `alembic upgrade head`
antes de iniciar el backend contra una base vacía. El arranque sólo crea un
administrador cuando todavía no existe ninguno y el operador configuró
`BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y
`BOOTSTRAP_ADMIN_PASSWORD`; nunca reemplaza administradores existentes.

## Detener los servicios

Para detener y retirar los contenedores sin borrar los datos de la base, ejecutá:

```bash
docker compose -p iot-app-base -f docker-compose.yml down
```

**No agregues `--volumes` salvo que quieras borrar los volúmenes y perder los
datos de la base local.**
