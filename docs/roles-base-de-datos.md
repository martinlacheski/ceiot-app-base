# Roles de la base de datos

La base usa tres roles. La aplicación nunca se conecta como superusuario: así
Row Level Security (RLS) filtra de verdad cada consulta de la API y de
mqtt-runtime, y un error de consulta en el código no expone datos de otro
usuario.

| Rol | Quién lo usa | Atributos | Qué puede hacer |
| --- | --- | --- | --- |
| `iot_app_admin` (`ALEMBIC_DB_USER`) | Alembic, trabajos de TimescaleDB, `scripts/backup.sh`, pgAdmin | `SUPERUSER` (usuario de la imagen, `POSTGRES_USER`) | Todo. Es dueño de la base, de los esquemas, tablas, vistas, funciones y trabajos |
| `iot_app` (`DB_USER`) | API (`backend`) y `mqtt-runtime` | `LOGIN`, sin `SUPERUSER`, `BYPASSRLS`, `CREATEDB` ni `CREATEROLE` | Leer y escribir en las tablas y vistas de `public`; RLS y las vistas filtran por `app.current_user_id` |
| `ai_readonly` | Consultas SQL del asistente | `NOLOGIN` | Solo las vistas de `ai_read`; `iot_app` cambia a este rol con `SET LOCAL ROLE` |

Los nombres se configuran en `timescaledb/.env` (`ALEMBIC_DB_USER`,
`ALEMBIC_DB_PASSWORD`, `DB_USER`, `DB_PASSWORD`); los de la tabla son los de la
plantilla.

## Qué recibe `iot_app`

La migración `0029` le otorga exactamente lo que la aplicación usa:

- `CONNECT` sobre la base y `USAGE` sobre el esquema `public` (no puede crear
  objetos).
- `SELECT, INSERT, UPDATE, DELETE` sobre las tablas y vistas de `public`,
  salvo:
  - `alembic_version`: nada;
  - `public.telemetry`: solo `SELECT` e `INSERT` (el disparador
    `guard_telemetry_write` además exige la identidad `system_mqtt` o
    `system_admin` para insertar);
  - `public.telemetry_hourly`: solo `SELECT`.
- `USAGE, SELECT` sobre las secuencias de `public` y `EXECUTE` sobre
  `public.rag_search`.
- Membresía en `ai_readonly` solo para `SET ROLE`, sin heredar sus permisos.
- Permisos por defecto: las tablas y secuencias que creen migraciones futuras
  en `public` (como `iot_app_admin`) quedan otorgadas de la misma forma.

Nada sobre `telemetry_store` ni `ai_read`. El nombre del rol lo indica
`DB_APP_ROLE` (Compose lo arma con `DB_USER`; por defecto `iot_app`). La
migración se niega a correr si ese rol es el mismo que migra o si tiene
`SUPERUSER`/`BYPASSRLS`.

Los permisos se guardan en el dump: `scripts/backup.sh` vuelca ambos roles (sin
contraseñas) y la verificación compara los permisos de tablas y esquemas
restaurados con los originales. Por qué no se revoca el esquema interno de
TimescaleDB y qué implica para los chunks: ver
[Ciclo de vida de los datos](ciclo-de-vida-datos.md#roles-y-permisos-sobre-hypertables-con-rls).

## Instalación nueva

Con un volumen de datos vacío no hay que hacer nada más que completar
`timescaledb/.env`:

1. La imagen crea el superusuario `ALEMBIC_DB_USER` con `ALEMBIC_DB_PASSWORD`.
2. `timescaledb/init/01-create-app-role.sh` (solo en ese primer arranque) crea
   `DB_USER` con `DB_PASSWORD`, sin privilegios especiales, y le da `CONNECT`.
3. `scripts/levantar.sh` aplica las migraciones como `ALEMBIC_DB_USER`; la
   `0029` otorga los permisos de `DB_USER`.

## Instalación existente: `scripts/separar-roles-db.sh`

Antes de este cambio el contenedor se inicializaba con
`POSTGRES_USER=DB_USER`, así que `iot_app` es el **superusuario de arranque**
del servidor (OID 10). PostgreSQL no permite quitarle `SUPERUSER` ("The
bootstrap user must have the SUPERUSER attribute") ni reasignar sus objetos
("required by the database system"). Por eso el script no reasigna nada:
**renombra** ese rol a `iot_app_admin` (todo lo que poseía, incluidos los
trabajos de TimescaleDB y la base, queda a nombre del administrador) y crea un
`iot_app` nuevo, sin privilegios, con la misma contraseña `DB_PASSWORD`.

Pasos para el operador:

1. Agregar a `timescaledb/.env` (sin cambiar `DB_USER` ni `DB_PASSWORD`):

   ```bash
   ALEMBIC_DB_USER=iot_app_admin
   ALEMBIC_DB_PASSWORD=<generar con: openssl rand -hex 24>
   ```

2. Revisar el plan sin cambiar nada:

   ```bash
   scripts/separar-roles-db.sh --dry-run
   ```

3. Ejecutarlo:

   ```bash
   scripts/separar-roles-db.sh
   ```

El script:

1. lee `timescaledb/.env` (nunca imprime sus valores) y exige que los dos
   usuarios y las dos contraseñas sean distintos;
2. detecta el estado; si no es "sin separar" ni "ya separado", se detiene sin
   tocar nada;
3. exige un backup verificado de las últimas 24 horas o ejecuta
   `scripts/backup.sh` (`--sin-backup` omite este paso, no se recomienda);
4. detiene `backend`, `mqtt-runtime` y `pgadmin`;
5. en una sola transacción, con un superusuario temporal conectado por el
   socket local del contenedor, renombra `DB_USER` a `ALEMBIC_DB_USER` con
   `ALEMBIC_DB_PASSWORD` y crea `DB_USER` con `DB_PASSWORD`; después borra el
   rol temporal;
6. reconstruye las imágenes del backend y ejecuta `scripts/levantar.sh`, que
   recrea PostgreSQL con el nuevo `POSTGRES_USER`, aplica la migración `0029`
   como administrador y levanta el resto;
7. comprueba el resultado: superusuario de arranque, atributos de `DB_USER`,
   versión de Alembic, dueño de los trabajos, membresía en `ai_readonly` y que
   `DB_USER` sin identidad no ve ningún dispositivo.

Es idempotente: si los roles ya están separados solo reasegura los atributos y
la contraseña de `DB_USER` y vuelve a levantar el stack.

**pgAdmin** guarda el servidor con el usuario anterior la primera vez que
arranca. Para que use `iot_app_admin`, recrear su volumen (el script imprime el
comando exacto) o cambiar el usuario en las propiedades del servidor.

## Comprobarlo

```sql
-- Atributos (como iot_app_admin)
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
WHERE rolname IN ('iot_app', 'iot_app_admin', 'ai_readonly');

-- RLS filtra a iot_app: sin identidad no ve dispositivos
SET ROLE iot_app;
SELECT count(*) FROM device;          -- 0
SELECT set_config('app.current_user_id', 'system_admin', false);
SELECT count(*) FROM device;          -- todos
RESET ROLE;
```
