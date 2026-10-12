# Ciclo de vida de los datos

La telemetría crece sin parar: una lectura por dispositivo cada pocos segundos.
Desde la migración `0028` la base la comprime, la resume por hora y borra lo
viejo de forma automática, sin cambiar lo que cada usuario puede ver.

## Resumen rápido

| Dato | Qué pasa | Cuándo |
| --- | --- | --- |
| `telemetry` (lecturas crudas) | Se comprime | Chunks con más de 7 días |
| `telemetry` (lecturas crudas) | Se borra | Más de 1 año |
| `telemetry_hourly` (resumen por hora) | Se comprime, **nunca se borra** | Más de 7 días |
| `sensorreading` (salud del equipo) | Se borra | Más de 90 días |
| `deviceoperation` rutinarias (`SENSOR_DATA`, `KEEP_ACTIVE`) | Se borran | Más de 90 días |
| `deviceoperation` con historia (`MOVE`, `UNPAIR`, `FIRMWARE_UPDATE`, `ERROR`, etc.) | Se conservan | Siempre |

Los gráficos con barras de una hora o más (`/telemetry/aggregate` con `1h`, `6h`
o `1d`) leen el resumen por hora, así que siguen funcionando después de que se
borren las lecturas crudas de más de un año.

## Por qué la telemetría ya no usa RLS

TimescaleDB 2.30 no permite comprimir ni crear agregados continuos sobre una
hypertable con Row Level Security habilitada o forzada:

```text
ERROR: columnstore cannot be used on table with row security
ERROR: cannot create continuous aggregate on hypertable with row security
```

Y una vez comprimida, la tabla ya no admite que se le habilite RLS. Por eso la
telemetría cambió de forma de protegerse (la "opción A" aprobada): la tabla
quedó en un esquema privado sin RLS y el filtro por usuario pasó a vistas.
`sensorreading` y `deviceoperation` conservan su RLS (la retención funciona con
RLS) y no se comprimen.

## Arquitectura

```text
                         escrituras (MQTT, system_mqtt)
                                     │
                                     ▼
public.telemetry (vista security_barrier) ──► telemetry_store.telemetry (hypertable, sin RLS)
   │  filtro = política anterior                  │  guard_telemetry_write (BEFORE)
   │                                              │  set_telemetry_environment_id (BEFORE)
   ▼                                              ▼
ai_read.telemetry (asistente)          telemetry_store.telemetry_hourly (agregado continuo)
                                                  │
                                                  ▼
                                  public.telemetry_hourly (vista security_barrier)
```

### Esquema privado `telemetry_store`

- `telemetry_store.telemetry` es la hypertable de siempre (mismas columnas,
  índices, claves foráneas y trigger de snapshot de ambiente).
- Nadie salvo su dueño (el rol de la aplicación que migra) tiene permisos sobre
  el esquema, la tabla, sus chunks ni las tablas internas del agregado. La
  migración revoca además los permisos que los chunks habían copiado
  (`ai_readonly`, `ceiot_rls_test`), que permitían leerlos sin filtro.

### Vista `public.telemetry`

- Mismo nombre y columnas que la tabla anterior: el modelo `Telemetry`, las
  consultas SQL y `ai_read.telemetry` no cambiaron.
- Es `security_barrier` y se ejecuta con los permisos de su dueño. Su `WHERE` es
  el predicado exacto de la política `device_data_access` (identidades
  `system_mqtt`/`system_admin`, administrador activo, miembro activo del
  ambiente del snapshot, invitado de ambiente o de dispositivo), más dos
  reglas:
  - **Bypass de superusuario/BYPASSRLS**: como antes con RLS, el login de la
    aplicación (superusuario en desarrollo) ve todo; el filtro aplica a los
    roles sin bypass (`ai_readonly` vía `SET LOCAL ROLE`, roles de prueba, un
    login de producción sin bypass).
  - **Ventana del invitado por fila**: el invitado ve una fila sólo si
    `access_starts_at <= time` (antes la base le mostraba todo el historial y
    sólo la API recortaba). Es la misma regla que ya aplicaba
    `ai_read.telemetry_visible`.
- Los filtros por `device_id` y `time` de las consultas son *leakproof*, así que
  PostgreSQL los empuja debajo de la barrera: se siguen usando el índice
  `ix_telemetry_device_time` y la exclusión de chunks.

### Escrituras: `guard_telemetry_write`

La vista es actualizable, así que la ingesta sigue insertando en `telemetry`. El
trigger `guard_telemetry_write` (BEFORE INSERT/UPDATE/DELETE, corre antes del
snapshot por orden alfabético) reemplaza a la política `device_data_system_write`:

- un rol sin bypass sólo puede **insertar** con `app.current_user_id` igual a
  `system_mqtt` o `system_admin`;
- un rol sin bypass **nunca** actualiza ni borra (antes ninguna política lo
  permitía);
- cualquier otro caso falla con SQLSTATE `42501`;
- superusuarios y roles BYPASSRLS pasan, como pasaban con RLS (incluye los
  borrados en cascada de las claves foráneas, que corren como dueño de la tabla).

La compresión, la descompresión y `drop_chunks` no disparan triggers de fila.

### Agregado continuo `telemetry_hourly`

`telemetry_store.telemetry_hourly` agrupa por hora (UTC), dispositivo, ambiente
del snapshot, sensor y variable, y guarda `sum_value`, `min_value`, `max_value` y
`readings` (sólo valores numéricos, con las mismas guardas `jsonb_typeof` que
las consultas crudas). Guarda la suma y la cantidad, no el promedio, para poder
reagregar sin error: el promedio de cualquier balde es `sum(sum_value) /
sum(readings)`, idéntico al `avg` sobre las filas crudas.

- **Tiempo real** (`materialized_only = false`): lo que todavía no se
  materializó se calcula al vuelo desde las lecturas crudas.
- **Política de refresco**: cada 30 minutos materializa la ventana
  `[ahora − 3 días, ahora − 1 hora]`.
- **Carga inicial**: la migración materializa todo el historial existente al
  final del `upgrade` (en un bloque autocommit, porque
  `refresh_continuous_aggregate` no puede correr dentro de una transacción) y
  recién después agrega la política de refresco.
- `public.telemetry_hourly` aplica el mismo predicado que `public.telemetry`
  usando `environment_id`, `device_id` y `bucket` (invitado: `access_starts_at
  <= bucket`). No está expuesta al asistente (`ai_readonly`).

### Uso en `/telemetry/aggregate`

Cuando el balde es de una hora o más, múltiplo de una hora, y el desfase
horario del navegador es de horas enteras (`utc_offset_minutes % 60 == 0`), la
API arma el resultado así:

- horas completas de la ventana → `public.telemetry_hourly`, rebaldeadas con
  `time_bucket(<balde>, bucket, <medianoche local>)`;
- horas parciales de los extremos (inicio y fin no alineados, o el inicio del
  invitado a mitad de hora) → lecturas crudas de `public.telemetry`.

El resultado es idéntico al de la consulta cruda (lo verifica
`tests/postgres/test_telemetry_rollup_parity.py` para `1h`, `6h` y `1d` con
UTC−3, ventanas alineadas y no alineadas, e invitados). Los baldes de menos de
una hora y los desfases de media hora siguen leyendo las lecturas crudas.

## Políticas y horarios

Todos los horarios están en **UTC** (la base corre en UTC); entre paréntesis, la
hora de Argentina (UTC−3). Se escalonan porque dos `drop_chunks` simultáneos
sobre tablas con claves foráneas a `device`/`environment` se bloquearon
mutuamente (deadlock `40P01`) en la prueba previa, y quedan después del backup
diario por defecto (03:00 hora local).

| Hora UTC | Trabajo | Qué hace |
| --- | --- | --- |
| 07:00 (04:00) | `policy_retention` sobre `telemetry_store.telemetry` | Borra chunks crudos de más de 1 año |
| 07:20 (04:20) | `policy_retention` sobre `public.sensorreading` | Borra chunks de más de 90 días |
| 07:40 (04:40) | `telemetry_store.prune_routine_device_operations` | Borra `SENSOR_DATA` y `KEEP_ACTIVE` de más de 90 días |
| 08:00 (05:00) | `policy_compression` sobre `telemetry_store.telemetry` | Comprime chunks de más de 7 días |
| 08:20 (05:20) | `policy_compression` sobre `telemetry_hourly` | Comprime el agregado de más de 7 días |
| cada 30 min | `policy_refresh_continuous_aggregate` | Materializa las últimas 72 horas (menos la última) |

Compresión de la telemetría: `segmentby = device_id`, `orderby = time DESC, id`.
Del agregado: `segmentby = device_id`, `orderby = bucket DESC`.

`deviceoperation` no usa retención por chunks: las filas `MOVE`/`UNPAIR` guardan
el nombre que tenía el equipo en el ambiente que dejó (migración `0027`) y el
historial depende de ellas. La limpieza la hace un job propio, que corre como su
dueño (el rol de la aplicación, superusuario) y fija `app.current_user_id =
'system_admin'` en su transacción. Un dueño sin BYPASSRLS no borraría nada,
porque `deviceoperation` no tiene política de DELETE.

## Qué conserva el historial de equipos anteriores

El historial (`/api/devices/history/devices` y sus pestañas por serial) lista un
par (serial, ambiente) mientras quede **alguna** evidencia visible para quien
consulta, en cualquiera de estas fuentes:

| Fuente | Cuánto dura | Qué aporta a la fila del historial |
| --- | --- | --- |
| `telemetry` (vía la vista `public.telemetry`) | 1 año | `readings_count`, fechas, existencia |
| `deviceoperation` con historia (`MOVE`, `UNPAIR`, `FIRMWARE_UPDATE`, `ERROR`, etc.) | Siempre | `operations_count`, nombre al irse, fechas, existencia |
| `deviceoperation` rutinarias (`SENSOR_DATA`, `KEEP_ACTIVE`) | 90 días | `operations_count`, fechas, existencia |
| `sensorreading` (salud del equipo) | 90 días | Sólo fechas y existencia |

- **`readings_count`** es la cantidad de filas de telemetría que el usuario puede
  abrir en la pestaña de telemetría, contada exacta sobre las lecturas crudas.
  No sale de `telemetry_hourly`: el resumen cuenta valores numéricos por
  variable (no filas) y no guarda el serial.
- **`operations_count`** cuenta las operaciones que quedan: después de 90 días
  ya no incluye las rutinarias.
- **`first_seen` / `last_seen`** son el mínimo y el máximo entre todas las
  fuentes visibles. Con el tiempo `first_seen` avanza (hasta 1 año atrás por la
  telemetría; antes, sólo por las operaciones que se conservan).
- **Alcance**: la telemetría y `sensorreading` cuentan sólo para miembros del
  ambiente (como la pestaña de telemetría); el invitado ve las operaciones desde
  el inicio de su acceso. El administrador ve todo y puede filtrar por dueño.
- Así, un equipo que se fue sigue en el historial de su establecimiento anterior
  durante un año por su telemetría, y para siempre si dejó una operación con
  historia (las salidas `MOVE`/`UNPAIR` se registran desde la migración `0027`).
  Un equipo que se fue antes de `0027` y del que ya no queda telemetría ni
  operaciones con historia desaparece del listado.
- **Rendimiento**: el listado agrupa por (serial, ambiente) todas las filas de
  telemetría visibles en una sola consulta (en desarrollo, ~4 ms para ~7.000
  filas). Es lineal en las filas visibles, hasta un año por ambiente; si crece
  demasiado, la salida es un resumen por (serial, ambiente) mantenido aparte, no
  el agregado por hora.

## Permisos sobre hypertables con RLS

TimescaleDB otorga `USAGE` sobre el esquema `_timescaledb_internal` a `PUBLIC`, y
cada chunk copia los permisos (`GRANT`) de su hypertable **pero no su RLS**. Por
eso, cualquier permiso sobre una hypertable con RLS otorgado a un rol sin bypass
expone las filas **sin filtrar** a través de sus chunks. La verificación lo
comprobó: el rol de prueba leyó 6.951 filas de `sensorreading` directamente de
`_timescaledb_internal._hyper_1_16_chunk` mientras la tabla padre le devolvía 0.

Regla: **nunca otorgar permisos sobre hypertables con RLS a roles sin bypass.**
Los datos se exponen mediante vistas que filtran (como `public.telemetry`,
`public.telemetry_hourly` y el esquema `ai_read` del asistente). El rol de
desarrollo `ceiot_rls_test` tiene esos permisos sólo porque lo prepara la suite
de pruebas; no es un rol de la aplicación y no debe existir en producción.

## Reglas operativas

- **Nunca refrescar el agregado con inicio `NULL`** (ni con un inicio anterior a
  la retención cruda). Refrescar un rango cuyas lecturas crudas ya se borraron
  **borra** también sus horas materializadas: se pierde el historial. Un refresco
  manual siempre lleva ventana explícita y reciente:

  ```sql
  CALL refresh_continuous_aggregate('telemetry_store.telemetry_hourly',
                                    '2026-10-01 00:00+00', '2026-10-05 00:00+00');
  ```

- **Datos tardíos**: la política sólo refresca los últimos 3 días. Si se cargan
  lecturas más viejas (importaciones, equipos que reenvían un buffer), quedan en
  las lecturas crudas pero el resumen por hora no las ve hasta refrescar esa
  ventana a mano, como arriba.
- **Cambios de esquema con chunks comprimidos**: agregar una columna nullable o
  con default funciona directo. Para otros cambios:
  1. pausar el job de compresión: `SELECT alter_job(<id>, scheduled => false);`
  2. descomprimir: `SELECT decompress_chunk(c, if_compressed => true) FROM show_chunks('telemetry_store.telemetry') c;`
  3. aplicar el `ALTER TABLE`;
  4. recomprimir: `CALL run_job(<id>);`
  5. reanudar: `SELECT alter_job(<id>, scheduled => true);`

  Cambiar columnas que lee el agregado obliga a recrearlo; como las lecturas de
  más de un año ya no existen, recrearlo pierde ese historial. Conviene crear un
  agregado nuevo al lado y migrar los datos antes de borrar el viejo.
- **Escalonar trabajos nuevos**: un job que borre chunks de otra tabla con
  claves foráneas no debe coincidir con los de la tabla de arriba.
- **Revertir**: `alembic downgrade 0027` elimina los jobs y el agregado,
  descomprime todo, devuelve la tabla a `public` con sus políticas y RLS
  forzado. Las horas resumidas de más de un año se pierden.

## Cómo inspeccionarlo

```sql
-- Trabajos, próxima ejecución y último resultado
SELECT job_id, proc_name, hypertable_schema, hypertable_name, schedule_interval, next_start
FROM timescaledb_information.jobs ORDER BY job_id;
SELECT job_id, last_run_status, last_run_started_at, total_runs, total_failures
FROM timescaledb_information.job_stats ORDER BY job_id;

-- Chunks y compresión
SELECT chunk_name, range_start, range_end, is_compressed
FROM timescaledb_information.chunks
WHERE hypertable_schema = 'telemetry_store' ORDER BY range_start;
SELECT * FROM hypertable_compression_stats('telemetry_store.telemetry');

-- Resumen por hora
SELECT count(*), min(bucket), max(bucket) FROM telemetry_store.telemetry_hourly;

-- Correr un trabajo ahora (por ejemplo, la compresión)
CALL run_job(<job_id>);
```

`scripts/backup.sh` incluye el esquema `telemetry_store` en el manifiesto
(conteos y huellas de la tabla cruda y de las filas materializadas del agregado,
chunks comprimidos, configuración de compresión y los trabajos con su horario),
así que la verificación del backup comprueba que todo eso se restaura igual. Ver
[`backups.md`](backups.md).
