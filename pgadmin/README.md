# Herramientas de desarrollo: pgAdmin y RedisInsight

Solo para desarrollo local. Ambas herramientas viven bajo el perfil `tools`: el
`docker compose up` normal no las levanta. Publican puertos **solo en
127.0.0.1** y no deben exponerse a otra red.

## Levantar y detener

```bash
cp pgadmin/.env.example pgadmin/.env   # una sola vez; editá email y contraseña
scripts/levantar.sh   # arrancan junto con el resto del stack
docker compose stop pgadmin redisinsight   # para apagarlas
```

| Herramienta | URL | Puerto (variable, opcional) |
| --- | --- | --- |
| pgAdmin | http://127.0.0.1:15050 | `PGADMIN_PORT` (default 15050) |
| RedisInsight | http://127.0.0.1:15540 | `REDISINSIGHT_PORT` (default 15540) |

Las variables de puerto se leen del entorno del shell o de un `.env` en la raíz.

## pgAdmin

- **Login**: `PGADMIN_DEFAULT_EMAIL` y `PGADMIN_DEFAULT_PASSWORD` de
  `pgadmin/.env` (git-ignorado). Sin ellos el contenedor se niega a arrancar y
  lo dice en sus logs (`docker compose logs pgadmin`); no hay
  contraseña por defecto.
- **Servidor preconfigurado** "IoT App (TimescaleDB)": host `postgresql`,
  puerto `5432`, base y usuario tomados de `DB_DATABASE` y `DB_USER` de
  `timescaledb/.env`. Al arrancar, el contenedor genera el `servers.json` y un
  passfile (`0600`) en su `/tmp` a partir de `DB_PASSWORD`: la contraseña nunca
  se escribe en el disco del host y no se pide al conectar.
- El servidor se importa solo la primera vez (con el volumen vacío). Si cambian
  la base, el usuario o la contraseña de la base: `docker compose
  rm -sf pgadmin && docker volume rm iot-app-base_pgadmin-data` y volver a levantar.
- **Persistencia**: volumen con nombre `pgadmin-data` (pgAdmin corre como uid
  5050 y un directorio bind creado por Docker quedaría de root, sin permisos de
  escritura).

## RedisInsight

- Sin login. Esta versión de la imagen **no** admite preconfigurar la conexión
  por variables de entorno: agregala una vez desde la interfaz
  (**Add Redis database**): host `redis`, puerto `6379`, sin usuario ni
  contraseña. Queda guardada en el volumen `redisinsight-data`.
- Redis no tiene puerto publicado en el host: solo se alcanza desde estas
  herramientas por la red interna `app-network`.

## SeaweedFS

Su UI (master `9333`, filer `8888`) no se publica; no se agregó proxy para no
tocar el servicio por defecto. Para mirarla temporalmente:
`docker compose exec seaweedfs wget -qO- http://127.0.0.1:9333/cluster/status`
o `docker compose run --rm -p 127.0.0.1:19333:9333 ...` según necesidad.
