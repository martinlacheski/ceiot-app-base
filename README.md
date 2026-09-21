# Levantá los cinco servicios de la aplicación en tu máquina

El Docker Compose de la raíz levanta el backend, el frontend, la landing,
TimescaleDB y EMQX en una misma red privada de Docker. Los puertos publicados
son accesibles únicamente desde tu máquina, a través de la interfaz local.

## Arranque

Ejecutá este comando desde la raíz del proyecto:

```bash
docker compose -p iot-app-base -f docker-compose.yml up -d --build --wait --wait-timeout 180
```

- La landing en: 
<http://localhost:14321>
- El frontend en: 
<http://localhost:15173>
- La API del backend en: 
<http://localhost:18000/api>
- Mailpit en: 
<http://localhost:8025>

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
En modo `DEV`, el backend usa `create_all` de SQLModel para crear las tablas e
inicializa el administrador de desarrollo. No ejecuta migraciones de Alembic,
no las marca como aplicadas y no configura políticas RLS. Cambiá de inmediato
la contraseña predeterminada `admin`, que es sólo para desarrollo.

## Detener los servicios

Para detener y retirar los contenedores sin borrar los datos de la base, ejecutá:

```bash
docker compose -p iot-app-base -f docker-compose.yml down
```

**No agregues `--volumes` salvo que quieras borrar los volúmenes y perder los
datos de la base local.**
