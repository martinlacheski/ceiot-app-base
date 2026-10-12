# Backups verificados

`scripts/backup.sh` genera un backup de la base y de los objetos S3, y
`scripts/verificar-backup.sh` demuestra que ese backup sirve: lo restaura en
una base descartable y comprueba que el resultado sea idéntico a lo que se
respaldó. Un backup sólo se da por bueno cuando la verificación termina con
`✅ Backup verificado`.

## Resumen rápido

Con el stack levantado (`scripts/levantar.sh`), desde la raíz del proyecto:

```bash
scripts/backup.sh                                  # backup + verificación
scripts/verificar-backup.sh backups/<fecha>        # volver a verificar uno existente
```

El código de salida es `0` con `✅ Backup verificado` y `1` con
`❌ Backup inválido: <motivos>`, así que sirve también para un pipeline. Para
programarlo todos los días, ver [Backup automático](#backup-automático-cron).

| Opción | Efecto |
| --- | --- |
| `--sin-verificar` | Genera el backup sin restaurarlo (verificalo después). |
| `--sin-s3` | Excluye a propósito los objetos S3; la verificación lo informa como aviso. |
| `--destino DIR` | Carpeta raíz de los backups (por defecto `backups/`). |
| `--conservar N` | Backups verificados a conservar (por defecto 7, o `BACKUP_KEEP`; `0` desactiva la retención). Ver [Retención](#retención). |
| `--solo-retencion` | Aplica la retención sin generar un backup. |

El backup sólo **lee** la base real (pg_dump y consultas de conteo). La
verificación no toca la base real ni el resto del stack: trabaja en un
contenedor propio que se elimina siempre, también si falla o se interrumpe.

Códigos de salida de `scripts/backup.sh`: `0` backup verificado (o generado,
con `--sin-verificar`), `1` backup inválido o error, `2` uso incorrecto y `75`
otra ejecución en curso (ver [Ejecuciones superpuestas](#ejecuciones-superpuestas)).

## Demo en vivo

`scripts/demo-backup.sh` recorre el proceso paso a paso, con pausas para
explicar cada etapa:

1. Genera un backup real y lo verifica (dump, manifiesto, S3 y restauración
   de prueba).
2. Muestra qué quedó guardado: archivos, snapshot exportado, versión de
   Alembic, filas de las tablas principales, políticas RLS y objetos S3.
3. Daña dos copias temporales del backup para mostrar que la verificación lo
   detecta:
   - dump truncado: falla la comprobación de checksums y la restauración;
   - manifiesto con un conteo alterado y checksums recalculados: el dump
     restaura, pero la base restaurada no coincide con lo declarado.
4. Borra las copias dañadas; el backup real queda en `backups/`.

```bash
scripts/demo-backup.sh                 # con pausas (Enter para avanzar)
scripts/demo-backup.sh --sin-pausas    # de corrido
scripts/demo-backup.sh --usar backups/<fecha>   # sin generar un backup nuevo
```

La demo sólo lee la base real. Cada verificación tarda unos segundos.

## Backup automático (cron)

El backup se programa en el **crontab del usuario del host** que levanta el
stack, no en un contenedor: la verificación arranca un contenedor descartable
y para eso necesita Docker, que el usuario del host ya tiene (un cron dentro
de un contenedor necesitaría el socket de Docker).

```bash
scripts/instalar-backup-cron.sh instalar                              # todos los días a las 03:00, conserva 7
scripts/instalar-backup-cron.sh instalar --hora 02:30 --conservar 14  # otra hora y otra retención
scripts/instalar-backup-cron.sh estado                                # línea instalada y último resultado
scripts/instalar-backup-cron.sh quitar                                # desprogramar
```

`instalar` agrega al crontab una sola línea, marcada con el comentario
`# ceiot-app-base backup`, por ejemplo:

```text
0 3 * * * '/ruta/al/proyecto/scripts/backup-cron.sh' --conservar 7 # ceiot-app-base backup
```

- Volver a ejecutar `instalar` reemplaza esa línea (no la duplica); `quitar`
  borra sólo esa línea. El resto del crontab no se toca, y si no se puede
  leer el crontab actual no se escribe nada.
- La hora es la del equipo (la zona horaria del sistema), no UTC.
- Si `COMPOSE_PROJECT_NAME` está definida al instalar, se agrega a la línea
  para que cron use el mismo proyecto de Docker Compose. Lo mismo con
  `BACKUP_NOTIFY_EMAIL` (destinatario de los avisos):
  `BACKUP_NOTIFY_EMAIL=ops@ejemplo.com scripts/instalar-backup-cron.sh instalar`.
- `MAIL_TRANSPORT` no se define en la línea: el correo de aviso sale con la
  configuración con la que corre el contenedor `backend`.
- El usuario tiene que poder usar Docker sin `sudo` (grupo `docker`);
  `instalar` avisa si no puede.

### Qué hace cada ejecución

cron ejecuta `scripts/backup-cron.sh`, que corre `scripts/backup.sh` (backup,
verificación y retención) sin terminal, con el PATH mínimo de cron
completado, y:

| Archivo | Contenido |
| --- | --- |
| `backups/logs/backup-<fecha UTC>.log` | Toda la salida de la ejecución. Los logs de más de 30 días se borran (`BACKUP_LOG_DAYS`). |
| `backups/ultimo-resultado.json` | Resultado de la última ejecución: `timestamp`, `status` (`ok`, `failed` o `skipped`), `exit_code`, `backup_dir`, `summary` (el veredicto de la verificación o la última línea de salida), `log` y `notification`. |

`scripts/instalar-backup-cron.sh estado` muestra los dos. El wrapper no
escribe nada en la salida estándar, así que cron no envía correos locales.

### Avisos de falla por correo

Si el backup falla (código distinto de `0`) o se omite (código `75`),
`backup-cron.sh` envía un correo con el **mailer de la aplicación**: ejecuta
`scripts/notificar-backup.py`, que corre un pequeño script dentro del
contenedor `backend` (`docker compose exec -T backend python -`) con
`app.core.email`. Así el correo usa el mismo transporte que la aplicación:

- en desarrollo (`MAIL_TRANSPORT=mailpit`) llega a Mailpit, en
  <http://localhost:8025>;
- en producción sale por el SMTP configurado en `backend/.env`.

Las credenciales de correo nunca salen del contenedor. El destinatario es
`BACKUP_NOTIFY_EMAIL` si estaba definida al ejecutar `instalar` (queda en la
línea del crontab) o, si no, el primer administrador activo de la aplicación. El asunto es
`Backup programado: falló en <equipo> - <MAIL_FROM_NAME>` y el cuerpo incluye
el resumen, la carpeta del backup, la ruta del log y sus últimas 40 líneas.

Si el contenedor `backend` no está corriendo (o no hay destinatario, o el
envío falla), el aviso no se puede enviar: queda registrado en el log y en el
campo `notification` de `ultimo-resultado.json` como `not sent (...)`.
Revisá `estado` de vez en cuando aunque no lleguen avisos.

### Retención

Después de un backup **verificado**, `scripts/backup.sh` borra backups viejos
de la carpeta destino:

- conserva los N backups verificados más recientes (`--conservar N`, por
  defecto 7); el que se acaba de generar nunca se borra;
- de los no verificados (verificación fallida, generados con
  `--sin-verificar` o carpetas `.incompleto` que quedaron de una ejecución
  interrumpida) conserva sólo el más reciente, para poder inspeccionarlo, y
  sólo si hay al menos un backup verificado;
- sólo considera carpetas con nombre `<fecha UTC>` o `<fecha UTC>.incompleto`:
  `logs/`, `ultimo-resultado.json` o una carpeta con otro nombre (por ejemplo
  una copia manual) no se tocan nunca.

Si la verificación falla, o con `--sin-verificar`, no se borra nada.
`--conservar 0` desactiva la retención. Para aplicarla sin hacer un backup:
`scripts/backup.sh --solo-retencion --conservar 7`.

### Ejecuciones superpuestas

Sólo puede correr un backup a la vez por carpeta destino: `scripts/backup.sh`
toma un lock (`flock`) sobre `backups/.lock`. Si otra ejecución lo tiene (por
ejemplo, un backup manual a la hora programada), la segunda termina con código
`75` sin tocar nada; desde cron queda como `skipped` y envía el aviso, porque
también puede indicar un backup colgado.

## Qué contiene un backup

Cada ejecución crea `backups/<fecha UTC>/` (por ejemplo
`backups/20261012T140120Z/`). La carpeta se arma como
`<fecha>.incompleto` y sólo se renombra al final, así que una carpeta sin ese
sufijo es un backup completo. `backups/` está en `.gitignore` y se crea con
permisos sólo para el dueño, porque contiene datos de la aplicación (incluidos
los hashes de contraseña de los usuarios).

| Archivo | Contenido |
| --- | --- |
| `db.dump` | `pg_dump -Fc` de la base (`DB_DATABASE`), generado dentro del contenedor `postgresql` (misma versión de PostgreSQL). |
| `roles.sql` | `pg_dumpall --roles-only --no-role-passwords`: roles, atributos y membresías, **sin contraseñas**. |
| `pg_dump.log` | Avisos de pg_dump (TimescaleDB informa claves foráneas circulares de su catálogo; es esperable). |
| `s3/objects/<clave>` | Copia de cada objeto del bucket (documentos `documents/<id>/<sha256>.<ext>` y firmware `firmware/<id>.bin`). |
| `manifest.json` | Descripción exacta de lo respaldado (ver abajo). |
| `SHA256SUMS` | Checksum de cada archivo anterior; se puede revisar también con `sha256sum -c SHA256SUMS`. |
| `verificacion.json` | Resultado de la última verificación (motivos, avisos, tiempos por paso). |

## Cómo se garantiza la consistencia

El dump y el manifiesto describen exactamente el mismo estado de la base,
aunque el stack siga recibiendo telemetría:

1. Una sesión abre una transacción `REPEATABLE READ` y exporta su snapshot
   con `pg_export_snapshot()`.
2. Mientras esa transacción sigue abierta, `pg_dump --snapshot=<id>` vuelca la
   base y el manifiesto se calcula en otra sesión que importa el mismo snapshot
   (`SET TRANSACTION SNAPSHOT`).
3. Recién después se cierra la transacción.

El manifiesto guarda, para las tablas y vistas de los esquemas `public` y
`ai_read`:

- conteo exacto de filas (en las hypertables, a través de la hypertable, no de
  los chunks);
- una huella de todo el contenido de cada tabla (suma de hashes de cada fila
  completa) y, en las tablas que no son hypertables, el md5 de las filas
  ordenadas por clave primaria; en las hypertables, el rango de tiempo;
- columnas, claves primarias, índices, restricciones, triggers, dueño y
  permisos de cada tabla; definición de las vistas;
- RLS: si está habilitada y forzada en cada tabla, y cada política (comando,
  roles, expresión);
- hypertables con cantidad de chunks, chunks comprimidos, dimensiones y
  configuración de compresión; jobs de políticas (compresión, retención,
  agregados continuos) y agregados continuos;
- roles existentes y los que la base necesita (`iot_app`, `ai_readonly`, ...);
- versión de Alembic, de PostgreSQL y de las extensiones (`timescaledb`,
  `vector`), codificación y locale de la base, e imagen del contenedor;
- cada objeto S3 con tamaño y sha256, y las referencias de la base a objetos
  (`document.storage_key`, `firmware_release.storage_key` con su sha256).

## Qué comprueba la verificación

`scripts/verificar-backup.sh` invalida el backup ante cualquiera de estas
fallas:

1. **Integridad de archivos**: un archivo de `SHA256SUMS` falta, cambió, o hay
   archivos que no figuran en la lista.
2. **Restauración**: arranca `ceiot-backup-verify-<aleatorio>` con la misma
   imagen del servicio `postgresql` (la registrada en el manifiesto si todavía
   existe localmente; si no, la de `docker compose config`), sin red, sin
   puertos publicados y con los jobs de TimescaleDB desactivados. Crea los
   roles de `roles.sql`, la base con la misma codificación y locale, las
   extensiones en la versión del manifiesto, y ejecuta
   `timescaledb_pre_restore()`, `pg_restore --exit-on-error` (conservando los
   dueños, porque los roles ya existen) y `timescaledb_post_restore()`.
   Cualquier error de `pg_restore` invalida el backup.
3. **Contenido**: recalcula el manifiesto sobre la base restaurada con el mismo
   código y exige coincidencia exacta con el del backup. Cada diferencia se
   informa con su ubicación, por ejemplo
   `database.stats[public.telemetry].rows: esperado 7376, obtenido 7375`.
4. **Objetos S3**: cada objeto guardado debe tener el tamaño y el sha256 del
   manifiesto; en los documentos, además, el sha256 que forma parte de su
   clave. Cada objeto que la base restaurada referencia tiene que estar en el
   backup con el mismo sha256. Si la base referencia objetos y la copia S3 no
   se pudo hacer, el backup es inválido (salvo exclusión explícita con
   `--sin-s3`, que queda como aviso).

En el stack de desarrollo la verificación completa tarda unos pocos segundos.

## Restaurar en la base real

No hay un script de restauración automática: reemplazar la base real es una
decisión del operador. El procedimiento recomendado restaura en una base
nueva, la verifica y recién entonces la pone en uso, de modo que la base
anterior queda disponible hasta el final. Usá un backup verificado y tomá un
backup nuevo de la base actual antes de empezar.

```bash
backup=backups/<fecha>
pg=$(docker compose ps -q postgresql)
user=$(docker exec "$pg" printenv POSTGRES_USER)

# 1. Detener lo que escribe en la base.
docker compose stop backend mqtt-runtime

# 2. Roles (los que ya existen dan error "already exists"; se pueden omitir).
#    El backup no trae contraseñas: definí las de los roles con LOGIN con
#    ALTER ROLE ... PASSWORD si hace falta.
docker exec -i "$pg" psql -U "$user" -d postgres < "$backup/roles.sql"

# 3. Base nueva con las extensiones en la versión del manifiesto.
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["database"]["extensions"])' "$backup/manifest.json"
docker exec -i "$pg" psql -U "$user" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE iot_db_restaurada TEMPLATE template0 OWNER iot_app;
\c iot_db_restaurada
CREATE EXTENSION timescaledb VERSION '<versión del manifiesto>';
CREATE EXTENSION vector VERSION '<versión del manifiesto>';
SELECT timescaledb_pre_restore();
SQL

# 4. Restaurar y cerrar la restauración de TimescaleDB.
docker cp "$backup/db.dump" "$pg":/tmp/restore.dump
docker exec "$pg" pg_restore --exit-on-error -U "$user" -d iot_db_restaurada /tmp/restore.dump
docker exec "$pg" psql -U "$user" -d iot_db_restaurada -c 'SELECT timescaledb_post_restore();'
docker exec "$pg" rm /tmp/restore.dump

# 5. Poner en uso la base restaurada (la anterior queda como iot_db_anterior).
#    Nadie puede estar conectado a iot_db: cerrá también pgAdmin si lo usás.
docker exec -i "$pg" psql -U "$user" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
ALTER DATABASE iot_db RENAME TO iot_db_anterior;
ALTER DATABASE iot_db_restaurada RENAME TO iot_db;
SQL

# 6. Levantar de nuevo (aplica las migraciones pendientes, si las hubiera).
scripts/levantar.sh
```

Reemplazá `iot_app` e `iot_db` por los valores de `timescaledb/.env` si son
otros. Cuando compruebes que todo funciona, podés borrar `iot_db_anterior`.

**Objetos S3**: subí cada archivo de `s3/objects/<clave>` al bucket
(`S3_BUCKET`, por defecto `ceiot-documents`) con la misma clave y el metadato
`sha256` con su hash, que es lo que el backend escribe y comprueba al subir.

## Limitaciones

- Los objetos S3 se copian después del snapshot de la base. Si un documento o
  firmware se borra justo en ese intervalo, la verificación lo informa como
  objeto referenciado faltante; repetí el backup. Los objetos creados en ese
  intervalo aparecen como aviso de objetos sin referencia.
- Sólo se respalda la base `DB_DATABASE` (no `iot_db_test` ni otras bases del
  servidor) y los esquemas `public` y `ai_read` son los que se describen en el
  manifiesto (el dump incluye todo).
- Las restricciones `CHECK` se comparan por nombre: PostgreSQL no reproduce
  textualmente algunas expresiones después de restaurarlas (agrega casts
  equivalentes), así que comparar su texto daría falsos negativos.
- Quedan fuera del backup y hay que resguardarlos aparte: los `.env` de cada
  componente, la CA y los certificados MQTT (`mqtt/pki/`, `mqtt/certs/`), los
  datos de EMQX (`mqtt/data/`) y de Redis (estado en vivo, se regenera).
- `roles.sql` no tiene contraseñas a propósito; después de restaurar en un
  servidor nuevo hay que definirlas.
