# Cambios de DVEM-App (18 de septiembre–23 de septiembre de 2026) para portar a este proyecto

> Documento de traspaso para el agente que trabaja en **ceiot-app-base** (base de monitoreo ambiental).
> Resume todo lo que se cambió en DVEM-App durante una larga sesión de trabajo, incluido lo que hizo otro agente
> (presencia por EMQX, pulso del dashboard y encabezados de marca en los reportes). Cada cambio indica qué problema resuelve, qué archivos toca y qué hay que
> adaptar. **Se excluyó todo lo relacionado con Mercado Pago y cobros**, porque este proyecto no tiene sistema de pagos. También se excluyó todo lo
> relacionado con HMPACKING/Expendedora (máquina vending) y con el almacenamiento de objetos para imágenes, porque este proyecto no tiene ninguna de las dos cosas.
>
> **Ampliado el 22 de septiembre** con los cambios 25 a 29: modo claro/oscuro, reorganización del sidebar, el criterio de "Volver" en pantallas raíz del
> sidebar, "Limpiar todos" en el dashboard, y la auditoría del buscador "Buscar en todos los campos" (esta última, trabajo de otro agente).
>
> **Ampliado el 23 de septiembre** con los cambios 30 a 35: buckets diarios de reportes en la fecha local del usuario, dispositivos ordenables por
> "Tipo", el aviso de privacidad de login/registro enlazado a la landing, un typecheck de producción limpio (con un fix genérico al `FormField` de shadcn),
> la desactivación del tipo de dispositivo legado "Other" vía migración, y el mapa del formulario de establecimiento siguiendo la altura del formulario.

## Qué hay que hacer

**Objetivo:** implementar en este proyecto (**ceiot-app-base**) lo que se desarrolló en DVEM-App durante esta sesión, **copiando los archivos que hacen falta desde
DVEM-App y adaptándolos**. Los archivos fuente están en `/home/martin/Code/DVEM-App` (misma máquina). En cada tabla de este documento, la primera columna es el
destino en este proyecto y la columna **"Leer en DVEM-App (origen)"** es la ruta absoluta del archivo que hay que copiar o consultar. Se trabaja con los archivos tal
como están hoy en DVEM-App; no hace falta mirar commits ni historial.

Si tu sesión no puede leer `/home/martin/Code/DVEM-App`, pedile el permiso al usuario antes de empezar.

### Trabajo a implementar (en este orden)

- [ ] **1. Limpieza de la identidad RLS al devolver una conexión al pool** (seguridad). Integrar `install_rls_identity_reset` de `backend/app/core/db.py` y copiar
  `backend/tests/postgres/test_rls_identity_reset.py`. Sin adaptación.
- [ ] **13. Infraestructura de tests contra PostgreSQL real.** Copiar la carpeta `backend/tests/postgres/` (README, `conftest.py`, escenario) y los ajustes de
  `frontend/vite.config.ts`. Quitar del escenario todo lo de pagos.
- [ ] **2. Historial de dispositivo por dueño y por establecimiento.** Copiar el módulo `backend/app/api/device/history/`, la migración de historial y los cambios de
  operaciones, sensores y router, con sus tests. Adaptar el backfill (no hay órdenes QR) y re-encadenar la migración a la cabeza de este proyecto.
- [ ] **5. Presencia online/offline desde la API de EMQX.** Copiar `backend/app/core/emqx_presence.py`, los cambios de configuración, modelos, repositorio y router de
  dispositivos, la guía de despliegue y los cambios de frontend. Adaptar el formato del `client_id` al serial de este proyecto.
- [ ] **4. Pulso de actividad para refrescar el dashboard sin recargar.** Copiar la migración del pulso, el modelo y el endpoint `activity`, el hook `useReportActivity` y
  el uso en el dashboard. Poner los triggers sobre `sensorreading` en lugar de pagos.
- [ ] **3. Dispositivos desvinculados visibles para el dueño anterior.** Copiar los endpoints de historial por serial y las pantallas de dispositivos desvinculados.
- [ ] **6. Mover un dispositivo a otro establecimiento.** Copiar el endpoint, el método de repositorio y sus tests, y en el frontend el bloque "Establecimiento",
  el diálogo y el hook. Quitar todo lo de comisiones.
- [ ] **7. Búsqueda por nombre en establecimientos y selector con búsqueda en el servidor.** Copiar el parámetro `search`, las mejoras de `SearchableSelect` y `useDebouncedValue`.
- [ ] **8. Mapa público de la landing alimentado por la API.** Copiar el endpoint público (con sesión de sistema por RLS) y, en `landing/`, los componentes del mapa completos,
  el cargador con refresco y la URL derivada. Definir qué significa "activo" en este proyecto.
- [ ] **9. Mapa de la aplicación con un marcador por ubicación.** Copiar `MapContainer.tsx`, `dotLayout.ts` y `groupDispensersByLocation.ts` con sus tests.
- [ ] **15. Reportes PDF y Excel con logos y títulos de marca.** Copiar `report-branding.ts`, la versión final de `export.utils.ts`, sus tests y ajustar los llamadores
  para esperar la exportación. Reemplazar logo, QR y frase institucional por los de este proyecto.
- [ ] **12. No registrar URLs con claves en los logs HTTP.** Copiar `backend/app/core/logging_config.py` y llamarlo al arrancar el backend y el runtime.
- [ ] **11. Búsqueda de direcciones sin sesgo a un país.** Aplicar los cambios de `GooglePlaceAutocomplete` y `AddressMapDialog`.
- [ ] **14. Formulario de asociar con `noValidate`.** Aplicar solo el patrón (sin el campo de importe).
- [ ] **16. Último login y última actividad de los usuarios, visibles en el admin.** Migración de `last_login_at` y `last_seen_at`, escritura en el login (contraseña y SSO) y desde `get_current_user` cada 15 minutos como máximo, corrección de `created_at`, y en el admin la columna "Último acceso" con tooltip. Cuidar que `updated_at` no cambie y que `created_at` use `default_factory`.
- [ ] **17. Estándar de pantallas de listado.** Copiar las piezas compartidas (`ListSearchInput`, `ListExportActions`, `ListFiltersAccordion`, `ListFilterFields`, `useDebouncedSearch`, `fetchAllPages`, `serverSorting`, `downloadReport`, `url-params`, encabezados centrados) y aplicarlas a **todas** las listas de este proyecto: buscador en todos los campos, Filtros, Excel/PDF de todas las filas filtradas y encabezados centrados. Subir `MAX_PER_PAGE` a 10000.
- [ ] **18. Botón "Volver" unificado** (`BackButton` al lado del título) en todas las pantallas, sin el texto a la vista.
- [ ] **19. Selector de rango de fechas en móvil:** pasar `mobileLayout` y `triggerClassName="w-full sm:w-auto"` en todas las pantallas que lo usen.
- [ ] **20. Panel inferior del mapa en móvil** (`Sheet` + `useMediaQuery`).
- [ ] **21. Etiquetas en español** con un módulo central y respaldo "humanizado", y búsqueda por etiqueta en el servidor con test de paridad.
- [ ] **22. Historial de dispositivos y de un dispositivo**, con la **telemetría** como pestaña principal (plantilla `HistoryTelemetryTab`), búsqueda, filtros y exportación.
- [ ] **23. Dispositivos ordenables por propietario, establecimiento y estado**, y columna "Estado".
- [ ] **24. Alineaciones menores** (Establecimientos en una fila, Permisos, altura de 44 px).
- [ ] **29. Auditoría "Buscar en todos los campos": paridad completa** en las 14 pantallas de listado, más dos bugs de datos encontrados al arreglar los tests (código postal de ciudades, suites legacy sin el prefijo `/api`).
- [ ] **25. Modo claro/oscuro persistente**, con la ronda de colores hardcodeados que rompían el tema (fondos, logos, autofill del navegador).
- [ ] **26. Reorganización del menú lateral** (Dispositivos, Historial, Usuarios y Mapa a la raíz) y filtro/orden del historial por propietario para administradores.
- [ ] **27. Pantallas de una sola tarjeta sin flecha de "Volver" cuando son raíz del sidebar** (`FormPageLayout` con `hideBackButton`), aplicado a Mi Perfil, Ajustes Generales y Cambiar Contraseña.
- [ ] **28. "Limpiar todos" también en el dashboard**, sincronización del selector de fechas no controlado tras limpiar, y una X redundante de menos en el selector de usuarios.
- [ ] **10. Catálogos de documentos y condiciones fiscales por país** (opcional; solo si este proyecto conserva datos fiscales de los usuarios).
- [ ] **31. Dispositivos ordenables por "Tipo"** en el listado. Agregar `deviceTypeName` al enum de ordenamiento del backend y a la columna del frontend.
- [ ] **34. Tipo de dispositivo legado "Other" desactivado vía migración**, en vez de recrearse y reactivarse solo. Copiar la migración de datos y simplificar el repositorio.
- [ ] **32. Aviso de privacidad en login y registro** enlazado a `/privacidad` de la landing. Este proyecto ya tiene `PRIVACY_POLICY_URL` en `publicUrls.ts` y la página `landing/src/pages/privacidad.astro`: solo falta usarlo en las dos pantallas.
- [ ] **33. Typecheck de producción limpio.** Verificar con `npm run build` (usa `tsc -b`, no `tsc --noEmit` sobre el tsconfig raíz) y aplicar el fix genérico al `FormField` compartido (tercer genérico `TTransformedValues`).
- [ ] **35. Mapa del formulario de establecimiento siguiendo la altura del formulario** (bajar `xl:min-h-[44rem]` a algo más chico, por ejemplo `xl:min-h-[24rem]`).
- [ ] **30. Buckets diarios de reportes en la fecha local del usuario, no en UTC** (solo si/cuando este proyecto tenga un endpoint de reportes con agregación por día, como el que trae el cambio 4): agregar `utc_offset_minutes` reutilizando `format_local`/`formatted_time` de `backend/app/api/device/history/query_utils.py` (cambio 22).

### Cómo copiar cada archivo

1. Abrí el archivo en DVEM-App (columna "origen") y el equivalente en este proyecto (primera columna).
2. **Archivo "nuevo"** (no existe aquí): copiarlo tal cual y adaptarlo (rutas de importación, nombres, dominio).
3. **Archivo "modificado"** (ya existe aquí): **no lo sobrescribas**. Este proyecto deriva de una versión anterior de DVEM y puede diferir. Compará ambos archivos y llevá a
   la versión de este proyecto lo que aporta la de DVEM.
4. Quitá todo lo de cobros (Mercado Pago, importes, comisiones, monedas) y adaptá lo marcado con ⚠.
5. Ejecutá los tests que se copian junto con cada cambio y comprobá que pasan antes de seguir con el siguiente.

Leyenda de las tablas: **nuevo** = archivo creado en DVEM-App; **modificado** = archivo que ya existía y cambió; **⚠** = archivo que se debe portar pero que **mezcla lógica de
cobros**: copiá solo el patrón y quitá todo lo relativo a pagos, comisiones, importes o monedas.

## Correspondencia de rutas y estado de partida de este proyecto (verificado)

Se comprobó contra `/home/martin/Code/ceiot-app-base`. **Leer antes de portar**:

- **La landing se llama `landing/` aquí y `frontend-landing/` en DVEM.** En las tablas de este documento las rutas ya están escritas con `landing/`; para
  leer un archivo en el repositorio de origen hay que usar `frontend-landing/` (la columna "origen" ya lo hace).
- **Archivos que todavía no existen aquí y hay que crear** (son los "nuevo" de las tablas): `backend/app/api/device/history/`, `backend/app/core/emqx_presence.py`,
  `backend/tests/postgres/`, `backend/ops/` (solo si se porta el cambio 10), las migraciones nuevas, `frontend/src/lib/report-branding.ts`, `dotLayout.ts`,
  `groupDispensersByLocation.ts`, `useDebouncedValue.ts`, etc.
- **La landing de este proyecto NO tiene todavía el mapa.** Tiene `landing/public/map-locations.json` (vacío, `[]`), `landing/src/config/publicUrls.ts` y una carpeta
  `landing/src/maps/` vacía, pero **no** existen `GoogleMapIsland.tsx` ni `MapSection.astro`, y `landing/package.json` **no** incluye `@vis.gl/react-google-maps`
  (`@astrojs/react` y `react` sí están). Para el cambio 8 no alcanza con aplicar los cambios de la tabla: hay que **copiar completos desde DVEM**
  `frontend-landing/src/components/MapSection.astro`, `frontend-landing/src/components/GoogleMapIsland.tsx` y `frontend-landing/src/maps/publicMap.ts`,
  junto con sus dependencias (`src/utils/brandText.ts` y el bloque `map` de `src/i18n/content.ts`), agregar la dependencia `@vis.gl/react-google-maps`, y recién
  después aplicar los cambios de este documento (`publicMapLoader.ts`, URL derivada, pines). Si este proyecto no va a tener mapa público, omitir el cambio 8.
- **`frontend/src/lib/export.utils.ts` existe aquí pero es una versión anterior** (sin encabezado de marca): para el cambio 15 hay que llevar la versión final de DVEM y
  adaptar los llamadores. `frontend/` sí tiene `@vis.gl/react-google-maps`.
- **Este proyecto deriva de una versión anterior de DVEM, no de la actual.** No se comparó archivo por archivo: por eso los archivos "modificado" se integran a mano, comparando ambas versiones, y no se sobrescriben.

## Resumen y prioridad

| # | Cambio | Prioridad | Adaptación |
| --- | --- | --- | --- |
| 1 | Limpieza de la identidad RLS al devolver una conexión al pool | **Alta (seguridad)** | Ninguna |
| 2 | Historial de dispositivo por dueño y por establecimiento (RLS + trigger + backfill) | Alta | Backfill por otra fuente |
| 3 | Visibilidad de dispositivos desvinculados para el dueño anterior | Media | Quitar columnas de cobro |
| 4 | Pulso de actividad para actualizar el dashboard sin recargar | Media | Triggers sobre lecturas, no pagos |
| 5 | Presencia online/offline consultando la API de EMQX | Alta | Formato del `client_id` |
| 6 | Mover un dispositivo a otro establecimiento en una transacción | Media | Quitar comisiones |
| 7 | Búsqueda por nombre en el listado de establecimientos y selector con búsqueda en el servidor | Media | Ninguna |
| 8 | Mapa público de la landing alimentado por la API | Media | Definir "activo" |
| 9 | Mapa de la aplicación: un marcador por ubicación con un punto por dispositivo | Media | Ninguna |
| 10 | Catálogos de documentos y condiciones fiscales por país, país del usuario | Opcional | Solo si se conservan datos fiscales |
| 11 | Búsqueda de direcciones sin sesgo a un país | Baja | Ninguna |
| 12 | No registrar en logs las URLs de las llamadas HTTP con claves | Media (seguridad) | Ninguna |
| 13 | Infraestructura de tests contra PostgreSQL real y ajustes de vitest | Alta | Quitar escenarios de cobro |
| 14 | Formulario de asociar: no bloquear el envío con validación nativa | Baja | Solo el patrón |
| 15 | Reportes PDF/Excel con logos, título institucional y título del reporte | Media | Marca, textos y columnas propias |
| 16 | Último login y última actividad de los usuarios, visibles en el admin | Media | Revisar RLS de `user`, zona horaria y cabeza de migraciones |
| 17 | Estándar de pantallas de listado (buscador, filtros, exportar, encabezados) | **Alta** | Aplicar a todas las listas; subir el tope de paginación |
| 18 | Botón "Volver" unificado | Media | Reemplazar enlaces y flechas propias |
| 19 | Selector de rango de fechas en móvil | Media | Ninguna |
| 20 | Panel inferior del mapa en móvil | Media | Ninguna |
| 21 | Etiquetas en español y búsqueda por etiqueta | Media | Mapas propios del proyecto |
| 22 | Historial de dispositivos y de un dispositivo (telemetría) | Media | Columnas y filtros de las magnitudes del proyecto |
| 23 | Dispositivos ordenables por propietario/establecimiento/estado | Baja | Ninguna |
| 24 | Alineaciones menores de pantallas | Baja | Ninguna |
| 25 | Modo claro/oscuro persistente | Media | Colores hardcodeados propios de este proyecto |
| 26 | Reorganización del menú lateral y filtro de historial por propietario | Media | Etiquetas y rutas propias |
| 27 | Pantallas de una sola tarjeta sin flecha de "Volver" en la raíz del sidebar | Baja | Ninguna |
| 28 | "Limpiar todos" en el dashboard, selector de fechas sincronizado, X redundante | Baja | Ninguna |
| 29 | Auditoría "Buscar en todos los campos": paridad completa + bugs de datos encontrados | **Alta** | Revisar si el bug del código postal y el de las rutas `/api` también están en este proyecto |
| 30 | Buckets diarios de reportes en la fecha local del usuario, no UTC | Baja (depende del cambio 4) | Reescribir sobre lecturas de sensores; solo aplica si hay reportes con agregación diaria |
| 31 | Dispositivos ordenables por "Tipo" | Baja | Ninguna |
| 32 | Aviso de privacidad de login/registro enlazado a la landing | Media | Ninguna (la URL y la página ya existen en este proyecto) |
| 33 | Typecheck de producción limpio (`tsc -b`) y fix genérico de `FormField` | Media | Ninguna |
| 34 | Tipo de dispositivo legado "Other" desactivado vía migración | Baja | Ninguna |
| 35 | Mapa del formulario de establecimiento sigue la altura del formulario | Baja | Ninguna |

Orden sugerido: 1 → 13 → 2 → 5 → 4 → 3 → 6 y 7 → 8 y 9 → 15 → 16 → 17 → 29 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 27 → 28 → 32 → 33 → 34 → 31 → 35 → 30 → resto.

---

## 1. Limpieza de la identidad RLS en el pool de conexiones (ALTA PRIORIDAD)

**Problema.** El backend fija la identidad para RLS con `set_config('app.current_user_id', <id>, false)` (a nivel de sesión) en
`get_authed_session`, `get_system_session` y `system_session()`. Al cerrar la sesión, la conexión vuelve al pool **sin limpiar** ese valor,
y la siguiente sesión que no fije su propia identidad (la sesión "anónima" `get_async_session`, que usan `get_current_user`, el registro,
el reseteo de contraseña, etc.) **hereda la identidad anterior**, incluida `system_mqtt`, que se salta RLS. Se reprodujo en local:
una sesión de sistema que hacía `commit` dejaba `system_mqtt` visible para una sesión anónima posterior.

**Solución.** `install_rls_identity_reset(engine)` en `backend/app/core/db.py` registra un evento `reset` del pool (motor síncrono y asíncrono,
solo PostgreSQL) que ejecuta `RESET app.current_user_id` y luego `COMMIT` (el reset por defecto del pool es un `ROLLBACK` y desharía el
`RESET`). Después del `RESET` la variable vale `''` (no `NULL`): las políticas deben tolerarlo (`<> ''` o `NULLIF(..., '')`); en DVEM ninguna
hacía `current_setting(...)::uuid` sin `NULLIF`. **Verificar lo mismo en las políticas de este proyecto antes de portar.**


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/core/db.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/core/db.py` |  |
| `backend/tests/postgres/test_rls_identity_reset.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_rls_identity_reset.py` |  |

Tests: `backend/tests/postgres/test_rls_identity_reset.py` (8 tests: fuga tras sesión de sistema, autenticada y `system_session()`, anónima sin filas,
identidad mantenida entre commits, sesiones solapadas). Importa fixtures de `test_public_map_rls.py` (ver cambio 8).

## 2. Historial de dispositivo por dueño y por establecimiento

**Problema.** El historial (`deviceoperation`, `sensorreading`) era visible a través del establecimiento **actual** del dispositivo. Tras
desasociar y asociar, el nuevo dueño veía todo el historial y el anterior lo perdía.

**Solución.**
- Cada fila registra el establecimiento dueño del dispositivo cuando se escribió: columna `environment_id` (nullable, indexada, FK
  `ON DELETE SET NULL`) en `deviceoperation` y `sensorreading`.
- Un trigger `BEFORE INSERT` **`SECURITY DEFINER`** (con `search_path = pg_catalog, pg_temp`) la completa desde el establecimiento actual del
  dispositivo si quien escribe no la envió, así el runtime y la aplicación no cambian su código de escritura.
- Las políticas RLS pasan a usar esa columna.
- **Backfill:** se reconstruye quién era dueño en cada momento a partir de las órdenes QR (`qrorder.environment_id` + `created_at`, UTC naive):
  "corridas" consecutivas de un mismo establecimiento; cada corrida es dueña de `[primera orden, primera orden de la siguiente)`; la primera
  se extiende hacia atrás y la última hacia adelante. **Aquí no existen órdenes QR**: si la base empieza vacía no hace falta backfill; si hay datos,
  hay que reconstruir la línea de tiempo con otra fuente (por ejemplo, el historial de asociaciones).
- Se revocan las invitaciones/relaciones de alcance dispositivo al eliminar o asociar un dispositivo.
- **TimescaleDB:** solo `sensorreading` es hypertable. Agregar columnas/triggers a una hypertable exige revisar la compresión y los chunks;
  el `downgrade` debe conservar `sensorreading.environment_id`. En DVEM se probó con TimescaleDB 2.25.1 (fijar la misma versión de imagen
  en local para restaurar copias de producción).


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/alembic/versions/s4t5u6v7w8x9_scope_device_history_to_environment.py` | nuevo | `/home/martin/Code/DVEM-App/backend/alembic/versions/s4t5u6v7w8x9_scope_device_history_to_environment.py` | ⚠ el backfill usa qrorder (cobros) y hay referencias a tablas financieras: adaptar |
| `backend/app/api/device/history/__init__.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/__init__.py` |  |
| `backend/app/api/device/history/router.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/router.py` |  |
| `backend/app/api/device/history/schemas.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/schemas.py` |  |
| `backend/app/api/device/history/serial.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/serial.py` |  |
| `backend/app/api/device/history/service.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/service.py` |  |
| `backend/app/api/device/operations/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/operations/models.py` |  |
| `backend/app/api/device/operations/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/operations/service.py` | ⚠ operaciones DISPENSE/pagos: revisar |
| `backend/app/api/device/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/router.py` | ⚠ mezcla presencia/historial/mover con cobros |
| `backend/app/api/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/router.py` |  |
| `backend/app/api/sensor/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/sensor/models.py` |  |
| `backend/tests/api/device/test_device_history_environment.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_device_history_environment.py` |  |
| `backend/tests/api/device/test_device_history_models.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_device_history_models.py` |  |
| `backend/tests/api/device/test_former_device_history.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_former_device_history.py` |  |
| `backend/tests/api/device/test_serial_from_external_reference.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_serial_from_external_reference.py` |  |
| `backend/tests/api/former_device_support.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/former_device_support.py` |  |
| `backend/tests/api/reports/test_former_device_reports.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/reports/test_former_device_reports.py` | ⚠ tests de reportes de ingresos |
| `backend/tests/postgres/README.md` | modificado | `/home/martin/Code/DVEM-App/backend/tests/postgres/README.md` |  |
| `backend/tests/postgres/former_owner_support.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/former_owner_support.py` |  |
| `backend/tests/postgres/history_support.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/history_support.py` |  |
| `backend/tests/postgres/test_device_history_rls.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_device_history_rls.py` |  |
| `backend/tests/postgres/test_former_device_history.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_former_device_history.py` |  |
| `backend/tests/postgres/test_former_owner_reports.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_former_owner_reports.py` | ⚠ tests de reportes de ingresos |

Tests contra PostgreSQL real: `test_device_history_rls.py`, `history_support.py` (ver cambio 13).

## 3. Dispositivos desvinculados visibles para el dueño anterior

**Problema.** Al desvincular un dispositivo, su dueño anterior dejaba de ver la historia de lo que ocurrió mientras fue suyo.

**Solución.** Endpoints de solo lectura `/api/devices/history/...` **por número de serie** para dispositivos ya no vinculados (el acceso se resuelve por
las filas históricas del cambio 2). Frontend: listado y detalle de "Dispositivos desvinculados", extracción de la tabla de operaciones para reutilizarla
(`DeviceOperationsResults`, `deviceOperationsColumns`), selector del dashboard con los vinculados en negrita y los desvinculados en normal, y el
grupo "Dispositivos vinculados". Nombre elegido con el usuario: **"desvinculado"** (no "anterior").


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/api/deviceHistory.api.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.test.ts` |  |
| `frontend/src/api/deviceHistory.api.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.ts` |  |
| `frontend/src/api/reports.api.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.test.ts` | ⚠ cliente de reportes de ingresos |
| `frontend/src/api/reports.api.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.ts` | ⚠ cliente de reportes de ingresos |
| `frontend/src/app/components/Sidebar.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Sidebar.test.tsx` |  |
| `frontend/src/app/components/Sidebar.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Sidebar.tsx` |  |
| `frontend/src/app/components/devices/DeviceOperationsResults.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceOperationsResults.tsx` | ⚠ resultados de operaciones con importes |
| `frontend/src/app/components/devices/deviceOperationsColumns.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/deviceOperationsColumns.tsx` | ⚠ columnas de operaciones con importes |
| `frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/pages/dashboard/dashboardReportExport.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/dashboardReportExport.test.ts` | ⚠ exportacion de reportes de ingresos |
| `frontend/src/app/pages/dashboard/dashboardReportExport.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/dashboardReportExport.ts` | ⚠ exportacion de reportes de ingresos |
| `frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.tsx` |  |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.test.tsx` |  |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` |  |
| `frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` |  |
| `frontend/src/app/pages/devices/FormerDevicesPage.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.tsx` |  |
| `frontend/src/app/pages/devices/UserDevicesPage.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/UserDevicesPage.test.tsx` |  |
| `frontend/src/app/pages/devices/UserDevicesPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/UserDevicesPage.tsx` |  |
| `frontend/src/router/app.router.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/router/app.router.test.tsx` |  |
| `frontend/src/router/app.router.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/router/app.router.tsx` |  |

## 4. Pulso de actividad para refrescar el dashboard sin recargar

**Problema.** El dashboard se refrescaba completo de manera molesta. Se quería actualizar solo el valor que cambió cuando llega un dato nuevo.

**Solución.**
- Tabla mínima `environment_activity(environment_id PK, version bigint, updated_at)`. Triggers `SECURITY DEFINER` incrementan `version` con
  `INSERT ... ON CONFLICT DO UPDATE` cada vez que se escribe un dato del establecimiento; cada función traga sus propias fallas
  (`EXCEPTION WHEN OTHERS` → `WARNING`) para no romper la escritura principal. RLS igual que las demás tablas (dueño, invitados, `system_*`).
  La migración bloquea brevemente las escrituras al crear los triggers y siembra la versión inicial.
- `GET /api/reports/activity` devuelve solo las versiones (consulta barata).
- Frontend: `useReportActivity` consulta cada ~15 s; solo cuando cambia la versión se invalidan las consultas del dashboard (`refetchType` selectivo),
  sin recargar la página.
- En DVEM los triggers están sobre `payment` y `paymentfee`. **En este proyecto deben estar sobre `sensorreading`** (y, si se quiere,
  `deviceoperation`).
- El rol de la aplicación no tiene `REFERENCES`: la migración crea la FK con el rol de migración y al rol de runtime le otorga **solo SELECT** (revoca INSERT/UPDATE/DELETE; los triggers escriben con su contexto `SECURITY DEFINER`).


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/alembic/env.py` | modificado | `/home/martin/Code/DVEM-App/backend/alembic/env.py` |  |
| `backend/alembic/versions/u6v7w8x9y0z1_add_environment_activity_pulse.py` | nuevo | `/home/martin/Code/DVEM-App/backend/alembic/versions/u6v7w8x9y0z1_add_environment_activity_pulse.py` | ⚠ triggers sobre payment/paymentfee: cambiar a sensorreading |
| `backend/app/api/reports/models.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/reports/models.py` | ⚠ reportes de ingresos: reescribir sobre lecturas de sensores |
| `backend/app/api/reports/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/reports/repository.py` | ⚠ reportes de ingresos: reescribir sobre lecturas de sensores |
| `backend/app/api/reports/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/reports/router.py` | ⚠ reportes de ingresos: reescribir sobre lecturas de sensores |
| `backend/app/api/reports/schemas.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/reports/schemas.py` | ⚠ reportes de ingresos: reescribir sobre lecturas de sensores |
| `backend/app/api/reports/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/reports/service.py` | ⚠ reportes de ingresos: reescribir sobre lecturas de sensores |
| `backend/app/main.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/main.py` |  |
| `backend/tests/api/reports/test_activity_endpoint.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/reports/test_activity_endpoint.py` | ⚠ tests de reportes de ingresos |
| `backend/tests/postgres/conftest.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/postgres/conftest.py` |  |
| `backend/tests/postgres/history_support.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/postgres/history_support.py` |  |
| `backend/tests/postgres/test_environment_activity.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_environment_activity.py` | ⚠ los triggers del pulso estan sobre payment/paymentfee: cambiar a sensorreading |
| `frontend/src/api/reports.api.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.test.ts` | ⚠ cliente de reportes de ingresos |
| `frontend/src/api/reports.api.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.ts` | ⚠ cliente de reportes de ingresos |
| `frontend/src/app/actions/dispenser.actions.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/actions/dispenser.actions.test.ts` |  |
| `frontend/src/app/actions/dispenser.actions.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/actions/dispenser.actions.ts` |  |
| `frontend/src/app/hooks/useReportActivity.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/hooks/useReportActivity.test.tsx` |  |
| `frontend/src/app/hooks/useReportActivity.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/hooks/useReportActivity.ts` |  |
| `frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |

## 5. Presencia online/offline consultando EMQX

*(Trabajo del otro agente, con correcciones posteriores.)*

**Problema.** El indicador de "en línea" salía de una bandera en la base de datos que no expiraba: un dispositivo desconectado seguía figurando en línea.

**Solución.**
- `backend/app/core/emqx_presence.py`: cliente de la API de administración de EMQX (`EMQX_API_BASE_URL`, `EMQX_API_KEY`, `EMQX_API_SECRET`, opcionales;
  ejemplo en `backend/.env.example`). Toma **instantáneas inmutables completas** con caché de 3 segundos y `singleflight`; sin ORM ni escrituras.
- Solo cuentan los `client_id` de la familia de dispositivos (`DVEM-XXXX-XXXX` en DVEM: **adaptar al formato de serial de este proyecto**), excluyendo
  los clientes del backend y del runtime, e intersectando con los dispositivos registrados y autorizados para quien consulta.
- Si el broker falla, la respuesta sigue siendo HTTP 200 con `brokerConnected` en `null` y metadatos de disponibilidad: el frontend muestra
  **"No disponible"** en vez de afirmar un conteo. Se rechazó devolver 503 o volver a la bandera de la base.
- El listado de dispositivos ordena por presencia en vivo **antes** de paginar. La respuesta de la API de EMQX puede omitir `count`: se trata
  como total desconocido y `meta.hasnext` (booleano) manda la paginación.
- La clave de la API de EMQX se crea en el dashboard de EMQX; tiene vencimiento: anotar la rotación. Guía en `docs/actualizaciones/device-online-broker-presence.md`.
  No se reinicia el runtime ni EMQX para este cambio.


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/.env.example` | modificado | `/home/martin/Code/DVEM-App/backend/.env.example` |  |
| `backend/app/api/device/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/models.py` | ⚠ contiene comisiones e importes |
| `backend/app/api/device/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/repository.py` | ⚠ contiene comisiones e importes (en `move` se copian tasas de comision) |
| `backend/app/api/device/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/router.py` | ⚠ mezcla presencia/historial/mover con cobros |
| `backend/app/core/config.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/core/config.py` |  |
| `backend/app/core/emqx_presence.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/core/emqx_presence.py` |  |
| `backend/app/main.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/main.py` |  |
| `backend/tests/api/device/test_broker_presence.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_broker_presence.py` |  |
| `backend/tests/api/device/test_list_presence_scope.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_list_presence_scope.py` |  |
| `backend/tests/conftest.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/conftest.py` |  |
| `backend/tests/core/test_emqx_presence.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/core/test_emqx_presence.py` |  |
| `docs/actualizaciones/device-online-broker-presence.md` | nuevo | `/home/martin/Code/DVEM-App/docs/actualizaciones/device-online-broker-presence.md` |  |
| `frontend/src/app/actions/dispenser.actions.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/actions/dispenser.actions.test.ts` |  |
| `frontend/src/app/actions/dispenser.actions.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/actions/dispenser.actions.ts` |  |
| `frontend/src/app/components/devices/DevicesTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.test.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` |  |
| `frontend/src/app/pages/dashboard/MapPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/MapPage.test.tsx` |  |
| `frontend/src/app/pages/dashboard/MapPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/MapPage.tsx` |  |
| `frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/services/device.service.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/device.service.test.ts` | ⚠ tipos y llamadas con importe/moneda/comisiones |
| `frontend/src/app/types/device.types.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/types/device.types.ts` | ⚠ tipos con importe/moneda/comisiones |
| `frontend/src/components/dashboard/map/MapContainer.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.test.tsx` |  |
| `frontend/src/components/dashboard/map/MapContainer.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.tsx` |  |
| `frontend/src/interfaces/dashboard.interface.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/interfaces/dashboard.interface.ts` |  |

## 6. Mover un dispositivo a otro establecimiento

**Problema.** Cambiar de establecimiento exigía desasociar y volver a asociar; en el medio el dispositivo quedaba sin establecimiento y las filas
escritas entonces (operaciones, lecturas) quedaban con `environment_id` NULL, es decir, ocultas.

**Solución.**
- `POST /api/devices/{device_id}/move` con `{ "environmentId": "<uuid>" }`, permiso `DevicePermissions.PAIR`. Autorización del origen igual que
  desasociar (dueño o `device:read_all`); del destino igual que asociar (dueño o admin).
- **Un solo `UPDATE` condicional** (`WHERE id = :id AND environment_id = :origen`): el dispositivo nunca pasa por NULL, así que ninguna fila queda oculta;
  lo escrito antes queda en el origen y lo posterior en el destino (por el trigger del cambio 2).
- Se eliminan las invitaciones/relaciones de alcance dispositivo (`cleanup_device_scope_access_on_unpair`); los invitados del establecimiento destino
  acceden por herencia. Tras el commit se publica la configuración con `force_qr_refresh=True` (en DVEM refresca el QR: **aquí usar solo el refresco de
  configuración**). Errores: 404 (no existe / no es tuyo), 409 (sin establecimiento, mismo establecimiento, cambió de estado), 403.
- En DVEM además se copian las tasas de comisión del destino: **quitar**.
- Frontend: bloque "Establecimiento" y botón "Mover a otro establecimiento" en Editar Dispositivo, diálogo con destinos (el usuario solo ve los suyos,
  el admin todos), `useMoveDevice` con invalidación de consultas. Si el formulario tiene cambios sin guardar, el botón se deshabilita y aparece un aviso
  con el botón **"Descartar cambios"** (con confirmación) arriba del bloque. Botones del diálogo: "Volver" / "Mover dispositivo".
- Causa de un bug de UI a evitar: pasar `className="gap-2 sm:gap-0"` a `DialogFooter` deja los botones pegados desde el breakpoint `sm` (tailwind-merge conserva `sm:gap-0`).


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/device/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/models.py` | ⚠ contiene comisiones e importes |
| `backend/app/api/device/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/repository.py` | ⚠ contiene comisiones e importes (en `move` se copian tasas de comision) |
| `backend/app/api/device/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/router.py` | ⚠ mezcla presencia/historial/mover con cobros |
| `backend/app/api/environment/environment/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/repository.py` |  |
| `backend/app/api/environment/environment/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/router.py` |  |
| `backend/app/api/environment/environment/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/service.py` | ⚠ contiene aprovisionamiento de tienda de cobros |
| `backend/tests/api/device/test_device_move.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_device_move.py` |  |
| `backend/tests/api/environment/test_environment_owner_filter.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/environment/test_environment_owner_filter.py` |  |
| `backend/tests/api/environment/test_environment_search.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/environment/test_environment_search.py` |  |
| `backend/tests/postgres/test_device_move_rls.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_device_move_rls.py` |  |
| `frontend/src/app/components/devices/DeviceEstablishmentBlock.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceEstablishmentBlock.tsx` |  |
| `frontend/src/app/components/devices/DeviceForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceForm.tsx` | ⚠ campos de importe y comisiones |
| `frontend/src/app/components/devices/MoveDeviceDialog.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/MoveDeviceDialog.test.tsx` | ⚠ textos de comisiones y advertencia de la sucursal de cobros |
| `frontend/src/app/components/devices/MoveDeviceDialog.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/MoveDeviceDialog.tsx` | ⚠ textos de comisiones y advertencia de la sucursal de cobros |
| `frontend/src/app/hooks/useDevices.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/hooks/useDevices.test.tsx` |  |
| `frontend/src/app/hooks/useDevices.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/hooks/useDevices.ts` |  |
| `frontend/src/app/pages/devices/EditDevicePage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/EditDevicePage.test.tsx` |  |
| `frontend/src/app/services/device.service.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/device.service.test.ts` | ⚠ tipos y llamadas con importe/moneda/comisiones |
| `frontend/src/app/services/device.service.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/device.service.ts` | ⚠ tipos y llamadas con importe/moneda/comisiones |

## 7. Búsqueda por nombre en establecimientos y selector con búsqueda en el servidor

**Problema.** El selector cargaba solo la primera página de 100 establecimientos y filtraba en el cliente.

**Solución.**
- `GET /api/environment/?search=` (recorta, coincide por subcadena sin distinguir mayúsculas, escapa `%` y `_`, se aplica antes de paginar).
  `owner_id` filtra estrictamente por propiedad (para un usuario normal se fuerza a su propio id): un test prueba que un establecimiento donde solo es
  invitado queda excluido.
- `SearchableSelect` ganó props opcionales y compatibles hacia atrás: `onSearchChange`, `shouldFilter` (por defecto `true`), `isLoading` ("Buscando..."),
  `selectedLabel` (el destino elegido no desaparece si ya no está en la lista). Nuevo hook `useDebouncedValue` (300 ms).
  Lo usan otras 9 pantallas: no cambiar su comportamiento por defecto.


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/environment/environment/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/repository.py` |  |
| `backend/app/api/environment/environment/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/router.py` |  |
| `backend/app/api/environment/environment/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/service.py` | ⚠ contiene aprovisionamiento de tienda de cobros |
| `backend/tests/api/environment/test_environment_owner_filter.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/environment/test_environment_owner_filter.py` |  |
| `backend/tests/api/environment/test_environment_search.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/environment/test_environment_search.py` |  |
| `frontend/src/app/services/environment.service.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/environment.service.test.ts` |  |
| `frontend/src/components/custom/SearchableSelect.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/SearchableSelect.test.tsx` |  |
| `frontend/src/components/custom/SearchableSelect.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/SearchableSelect.tsx` |  |
| `frontend/src/hooks/useDebouncedValue.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useDebouncedValue.test.tsx` |  |
| `frontend/src/hooks/useDebouncedValue.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useDebouncedValue.ts` |  |

## 8. Mapa público de la landing alimentado por la API

**Problema.** El mapa leía un `map-locations.json` estático que había que editar y subir a mano.

**Solución.**
- `GET /api/public/map/locations` (sin autenticación) devuelve solo `displayName, latitude, longitude, city, state, country, activeDeviceCount`:
  **sin IDs, seriales, dueños ni estado online/offline**. Encabezado `Cache-Control: public, max-age=60`.
- Cuenta un dispositivo si está habilitado, activo y con estado `ACTIVE` o `MAINTENANCE`, **sin distinguir online de offline**; un establecimiento
  aparece si tiene al menos uno y coordenadas válidas. Ya no exige la marca `is_public_map_visible` (decisión: todos los establecimientos con
  dispositivos activos son públicos). **Aquí definir qué es "activo"** (por ejemplo, un dispositivo que reportó lecturas).
- **Trampa de RLS:** el endpoint debe usar la **sesión de sistema** (`SystemAsyncDBSession`). Con la sesión anónima devolvía `[]` porque `device` y
  `environment` tienen RLS forzado; los tests con SQLite no lo detectaban. Se añadió un test contra PostgreSQL real.
- Landing (`landing/`): `publicMapLoader.ts` consulta al cargar la página y cada 5 minutos solo con la pestaña visible; si la primera carga falla
  cae al JSON estático; si un refresco falla conserva los últimos datos; una respuesta vacía exitosa **no** dispara el respaldo.
  `publicUrls.ts` deriva la URL de `PUBLIC_API_BASE_URL` (`<base>/public/map/locations`) salvo que se defina `PUBLIC_MAP_LOCATIONS_URL`.
  Los `PUBLIC_*` se fijan al compilar: hay que reconstruir la landing, y en producción `PUBLIC_MAP_LOCATIONS_URL` debe estar vacía. Requiere CORS
  del origen de la landing en `BACKEND_CORS_ORIGINS`.
- Estilo de los pines (decisión del usuario): 20 px, borde blanco de 3 px, sombra, color negro (`neutral-900`).
- El endpoint viejo `/api/public/map/devices` (orientado a dispositivos: devolvía el ID, el nombre y el estado de cada dispositivo, y tenía el mismo problema de RLS) **se eliminó** en DVEM, junto con la landing vieja en React que lo usaba. **No portarlo.** Si este proyecto tiene un endpoint público equivalente, hay que borrarlo o reemplazarlo por `/map/locations`: un endpoint público no debe exponer IDs, nombres ni estado de dispositivos.


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/public/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/public/router.py` |  |
| `backend/tests/api/public/test_router.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/public/test_router.py` |  |
| `backend/tests/postgres/test_public_map_rls.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_public_map_rls.py` |  |
| `landing/.env.example` | modificado | `/home/martin/Code/DVEM-App/frontend-landing/.env.example` |  |
| `landing/src/components/GoogleMapIsland.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend-landing/src/components/GoogleMapIsland.tsx` |  |
| `landing/src/config/publicUrls.ts` | modificado | `/home/martin/Code/DVEM-App/frontend-landing/src/config/publicUrls.ts` |  |
| `landing/src/maps/publicMapLoader.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend-landing/src/maps/publicMapLoader.ts` |  |
| `landing/tests/public-map-loader.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend-landing/tests/public-map-loader.test.ts` |  |
| `landing/tests/public-urls.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend-landing/tests/public-urls.test.ts` |  |

## 9. Mapa de la aplicación: un marcador por ubicación

**Problema.** Con dos dispositivos en el mismo establecimiento los marcadores quedaban exactamente superpuestos y el último dibujado (rojo, offline)
tapaba al verde.

**Solución.** `groupDispensersByLocation` agrupa por coordenadas redondeadas a 6 decimales. Un dispositivo solo se dibuja como antes; varios se dibujan
como puntos **encimados** con la forma de un polígono regular (2 lado a lado, 3 triángulo, 4 cuadrado…, máximo 8 y "+N" debajo), sin fondo, con
borde blanco y sombra por punto. `dotLayout.ts` calcula las posiciones (`DOT_SIZE = 16`, superposición `DOT_OVERLAP`, ajustada a mano por el usuario a 0,6).
Los marcadores se anclan por el **centro** (`AdvancedMarkerAnchorPoint.CENTER`) para que un grupo grande no quede desplazado hacia arriba. El
`InfoWindow` lista un bloque por dispositivo con su estado y "Ver detalles".


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/dashboard/map/MapContainer.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.test.tsx` |  |
| `frontend/src/components/dashboard/map/MapContainer.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.tsx` |  |
| `frontend/src/components/dashboard/map/dotLayout.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/dotLayout.test.ts` |  |
| `frontend/src/components/dashboard/map/dotLayout.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/dotLayout.ts` |  |
| `frontend/src/components/dashboard/map/groupDispensersByLocation.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/groupDispensersByLocation.ts` |  |

## 10. Catálogos de documentos y condiciones fiscales por país (opcional)

Solo tiene sentido si este proyecto conserva datos fiscales de los usuarios. Agrega `country` a los catálogos de tipos de documento y condiciones
fiscales (la unicidad pasa a ser por país), `country` al usuario, selector de país en el registro y en el perfil, y filtro de catálogos por país del usuario.
Migración `r3s4t5u6v7w8_add_country_to_tax_catalogs_and_user.py` (verificada con scratch DB: los datos existentes pasan a `AR`, `downgrade` se niega si el
mismo nombre existe en dos países). Scripts de carga idempotentes en `backend/ops/` (`seed_tax_catalog.py`, `ops/data/tax_catalog.v1.json`).


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/alembic/versions/r3s4t5u6v7w8_add_country_to_tax_catalogs_and_user.py` | nuevo | `/home/martin/Code/DVEM-App/backend/alembic/versions/r3s4t5u6v7w8_add_country_to_tax_catalogs_and_user.py` |  |
| `backend/app/api/auth/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/models.py` |  |
| `backend/app/api/auth/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/repository.py` |  |
| `backend/app/api/auth/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/service.py` |  |
| `backend/app/api/tax/identification_type/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/identification_type/models.py` |  |
| `backend/app/api/tax/identification_type/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/identification_type/repository.py` |  |
| `backend/app/api/tax/identification_type/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/identification_type/router.py` |  |
| `backend/app/api/tax/identification_type/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/identification_type/service.py` |  |
| `backend/app/api/tax/tax_type/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/tax_type/models.py` |  |
| `backend/app/api/tax/tax_type/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/tax_type/repository.py` |  |
| `backend/app/api/tax/tax_type/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/tax_type/router.py` |  |
| `backend/app/api/tax/tax_type/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/tax_type/service.py` |  |
| `backend/app/core/utils.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/core/utils.py` |  |
| `backend/ops/README.md` | modificado | `/home/martin/Code/DVEM-App/backend/ops/README.md` |  |
| `backend/ops/data/tax_catalog.v1.json` | nuevo | `/home/martin/Code/DVEM-App/backend/ops/data/tax_catalog.v1.json` |  |
| `backend/ops/seed_tax_catalog.py` | nuevo | `/home/martin/Code/DVEM-App/backend/ops/seed_tax_catalog.py` |  |
| `backend/tests/alembic/test_country_catalogs_revision.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/alembic/test_country_catalogs_revision.py` |  |
| `backend/tests/alembic/test_device_type_code_revision.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/alembic/test_device_type_code_revision.py` |  |
| `backend/tests/api/tax/test_country_catalogs.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/tax/test_country_catalogs.py` |  |
| `backend/tests/api/tax/test_seed_tax_catalog.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/tax/test_seed_tax_catalog.py` |  |
| `frontend/src/admin/actions/catalog-country.actions.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/admin/actions/catalog-country.actions.test.ts` |  |
| `frontend/src/admin/actions/financial.actions.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/actions/financial.actions.ts` |  |
| `frontend/src/admin/actions/identification.actions.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/actions/identification.actions.ts` |  |
| `frontend/src/admin/actions/user.actions.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/actions/user.actions.test.ts` |  |
| `frontend/src/admin/actions/user.actions.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/actions/user.actions.ts` |  |
| `frontend/src/admin/components/settings/financial/IdentificationTypeForm.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/IdentificationTypeForm.test.tsx` |  |
| `frontend/src/admin/components/settings/financial/IdentificationTypeForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/IdentificationTypeForm.tsx` |  |
| `frontend/src/admin/components/settings/financial/IdentificationTypesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/IdentificationTypesTable.tsx` |  |
| `frontend/src/admin/components/settings/financial/TaxTypeForm.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/TaxTypeForm.test.tsx` |  |
| `frontend/src/admin/components/settings/financial/TaxTypeForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/TaxTypeForm.tsx` |  |
| `frontend/src/admin/components/settings/financial/ViewIdentificationTypeDialog.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/ViewIdentificationTypeDialog.tsx` |  |
| `frontend/src/admin/components/settings/financial/__tests__/CatalogTypesTablesToolbar.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/__tests__/CatalogTypesTablesToolbar.test.tsx` |  |
| `frontend/src/admin/components/settings/tax/TaxTypesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/tax/TaxTypesTable.tsx` |  |
| `frontend/src/admin/components/settings/tax/ViewCatalogDialogs.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/tax/ViewCatalogDialogs.test.tsx` |  |
| `frontend/src/admin/components/settings/tax/ViewTaxTypeDialog.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/tax/ViewTaxTypeDialog.tsx` |  |
| `frontend/src/admin/components/users/UserForm.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/UserForm.test.tsx` |  |
| `frontend/src/admin/components/users/UserForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/UserForm.tsx` |  |
| `frontend/src/admin/hooks/useFinancial.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/hooks/useFinancial.ts` |  |
| `frontend/src/admin/pages/settings/financial/CreateTaxTypePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/financial/CreateTaxTypePage.tsx` |  |
| `frontend/src/app/pages/profile/ProfilePage.country.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.country.test.tsx` |  |
| `frontend/src/app/pages/profile/ProfilePage.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.test.ts` |  |
| `frontend/src/app/pages/profile/ProfilePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.tsx` |  |
| `frontend/src/app/pages/profile/profile.schema.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/profile.schema.ts` |  |
| `frontend/src/auth/actions/register.action.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/auth/actions/register.action.test.ts` |  |
| `frontend/src/auth/actions/register.action.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/actions/register.action.ts` |  |
| `frontend/src/auth/actions/update-user.action.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/actions/update-user.action.test.ts` |  |
| `frontend/src/auth/actions/update-user.action.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/actions/update-user.action.ts` |  |
| `frontend/src/auth/pages/register/RegisterPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.test.tsx` |  |
| `frontend/src/auth/pages/register/RegisterPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.tsx` |  |
| `frontend/src/auth/store/auth.store.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/store/auth.store.test.ts` |  |
| `frontend/src/auth/store/auth.store.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/store/auth.store.ts` |  |
| `frontend/src/components/custom/CountrySelect.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/CountrySelect.test.tsx` |  |
| `frontend/src/components/custom/CountrySelect.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/CountrySelect.tsx` |  |
| `frontend/src/components/custom/SmartPhoneInput.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/SmartPhoneInput.test.tsx` |  |
| `frontend/src/components/custom/SmartPhoneInput.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/SmartPhoneInput.tsx` |  |
| `frontend/src/constants/supported-countries.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/constants/supported-countries.test.ts` |  |
| `frontend/src/constants/supported-countries.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/constants/supported-countries.ts` |  |
| `frontend/src/hooks/useCountryScopedCatalogs.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useCountryScopedCatalogs.test.tsx` |  |
| `frontend/src/hooks/useCountryScopedCatalogs.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useCountryScopedCatalogs.ts` |  |
| `frontend/src/interfaces/identification.interface.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/interfaces/identification.interface.ts` |  |
| `frontend/src/interfaces/tax.interface.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/interfaces/tax.interface.ts` |  |
| `frontend/src/interfaces/user.interface.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/interfaces/user.interface.ts` |  |

## 11. Búsqueda de direcciones sin sesgo a un país

`GooglePlaceAutocomplete` y `AddressMapDialog` fijaban `region: "AR"` y centraban el mapa en Argentina. Ahora el país sale del establecimiento y el
selector no fuerza un país por defecto. 
| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/components/environments/EnvironmentDetailDialog.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentDetailDialog.tsx` |  |
| `frontend/src/app/components/environments/EnvironmentForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentForm.tsx` |  |
| `frontend/src/auth/pages/register/RegisterPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.test.tsx` |  |
| `frontend/src/auth/pages/register/RegisterPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.tsx` |  |
| `frontend/src/components/custom/AddressMapDialog.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/AddressMapDialog.test.tsx` |  |
| `frontend/src/components/custom/AddressMapDialog.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/AddressMapDialog.tsx` |  |
| `frontend/src/components/custom/GooglePlaceAutocomplete.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/GooglePlaceAutocomplete.test.tsx` |  |
| `frontend/src/components/custom/GooglePlaceAutocomplete.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/GooglePlaceAutocomplete.tsx` |  |

## 12. No registrar URLs con claves en los logs HTTP

Los clientes HTTP (`httpx`) registraban a nivel INFO cada URL solicitada, incluidas claves de API en la query. `backend/app/core/logging_config.py`
expone `quiet_http_client_logs()`, que sube esos loggers a `WARNING`; se invoca al arrancar `main.py` y el runtime (`main_runtime.py`). 
| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/core/logging_config.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/core/logging_config.py` |  |
| `backend/app/main.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/main.py` |  |
| `backend/app/main_runtime.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/main_runtime.py` | ⚠ en DVEM es el runtime de pagos; en la base puede ser el runtime MQTT: solo llamar `quiet_http_client_logs()` |
| `backend/tests/core/test_logging_config.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/core/test_logging_config.py` |  |

## 13. Tests contra PostgreSQL real y ajustes de vitest

**Lección central:** la suite con SQLite es más permisiva que PostgreSQL (no tiene RLS, `GROUP BY` estricto ni tipos estrictos), por eso hubo errores que solo
aparecieron en producción (por ejemplo `psycopg GroupingError`: un parámetro enlazado en el `SELECT` no coincide con el del `GROUP BY`; se resolvió
renderizando el literal con `literal(...).render_literal_execute()`; hay un test que compila la consulta con el dialecto de PostgreSQL).

**Infraestructura (opt-in):** `backend/tests/postgres/` con `TEST_POSTGRES_URL`, base `dvem_test`, un rol **no superusuario** con RLS forzado
(`dvem_rls_test`) y una negativa explícita a ejecutarse contra la base real. `README.md` explica cómo levantarla. Los tests de RLS deben ejecutarse
con ese rol, no como superusuario, porque el superusuario se salta RLS.

**Frontend:** `frontend/vite.config.ts` fija `VITE_API_URL` para vitest y sube `testTimeout`/`hookTimeout` a 20 s (las pruebas pesadas fallaban por timeout en
una máquina ocupada).


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/tests/conftest.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/conftest.py` |  |
| `backend/tests/postgres/README.md` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/README.md` |  |
| `backend/tests/postgres/__init__.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/__init__.py` |  |
| `backend/tests/postgres/conftest.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/conftest.py` |  |
| `backend/tests/postgres/scenario.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/scenario.py` | ⚠ escenario con pagos/ordenes QR: quitar las partes de cobro |
| `backend/tests/postgres/test_report_endpoints.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_report_endpoints.py` | ⚠ tests de reportes de ingresos |
| `backend/tests/postgres/test_report_repository.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_report_repository.py` | ⚠ tests de reportes de ingresos |
| `frontend/vite.config.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/vite.config.ts` |  |

Referencia de resultados en DVEM: suite por defecto con 17 fallas y 17 errores previos e idénticos (base de comparación), `tests/postgres` con 112 tests
verdes. Conviene registrar una base de comparación equivalente en este proyecto antes de portar.

## 14. Formulario de asociar: validación nativa del navegador

Un `<input min="0.01">` con valor 0 hacía que el navegador bloqueara el envío con su globito **antes** de que corriera la validación del formulario:
no salían los mensajes propios. Se resolvió con `noValidate` en el `<form>` y quitando el bloqueo del botón por validación (el botón solo se deshabilita
mientras se está enviando o comprobando el serial): al enviar se marcan todos los campos incorrectos y el foco va al primero. 
| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/pages/devices/PairDevicePage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/PairDevicePage.test.tsx` | ⚠ campo importe: portar solo el patron `noValidate` |
| `frontend/src/app/pages/devices/PairDevicePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/PairDevicePage.tsx` | ⚠ campo importe: portar solo el patron `noValidate` |

## 15. Reportes PDF y Excel con logos y títulos de marca

*(Trabajo del otro agente, ya integrado en `master` de DVEM-App.)*

**Objetivo.** Todo reporte que la aplicación exporta desde el navegador (jsPDF + `jspdf-autotable` para PDF y ExcelJS para Excel) lleva el mismo encabezado
de marca: logo, título institucional de la plataforma y, debajo, el título propio del reporte. No hay cambios de backend, de datos ni de consultas.

**Diseño final (el que hay que portar).** Las decisiones se corrigieron tres veces según capturas del usuario; **vale la última (T4)**:
- Una **sola fila horizontal**: logo pequeño a la izquierda (34 mm en PDF, 128 px en Excel), frase institucional centrada en una línea (PDF 12 pt; Excel Arial
  Bold 10 pt sin ajuste de línea, fila 1 de 42 pt y fila 2 de 8 pt como separador) y el QR a la derecha, reducido (11 mm en PDF, 42 px en Excel) pero **un poco más alto**
  que el logo; ambas imágenes alineadas verticalmente y con su proporción original.
- Sin el texto suelto "DVEM" (la marca aparece solo en la imagen) y **sin recuadro adicional** alrededor del QR.
- El título específico del reporte sigue visible; los metadatos y los encabezados de tabla quedan debajo del bloque de marca.
- **PDF:** el encabezado se repite en **todas las páginas** y reserva un margen superior para que la tabla nunca se superponga; se conservan pie de página
  (generador, fecha, numeración) y totales; funciona en vertical y horizontal. **Excel:** el bloque de marca queda al inicio de la hoja, con márgenes de impresión y
  filas repetibles donde el visor lo permite (no se promete repetir las imágenes en cada página impresa).
- El autoajuste de columnas de Excel **excluye** las filas de marca, título y metadatos, para que los títulos combinados no ensanchen las columnas. Se fuerza la
  fuente **Arial** porque, con objetos de fuente parciales, algunos visores caían a una fuente con serifa.

**Cómo funciona.**
- `frontend/src/lib/report-branding.ts`: carga una sola vez `dvem-logo.png` y `qr.svg` desde `frontend/public/`, **rasteriza** el SVG con un canvas a PNG
  (`data URL`), guarda el resultado en caché y **reinicia la caché si falla** para permitir reintentos; timeout de 15 s por imagen. Exporta
  `REPORT_BRAND_TAGLINE` (en DVEM: "Plataforma de Gestión, Operación y Cobros Digitales" — **cambiarla**, menciona cobros).
- `frontend/src/lib/export.utils.ts`: `exportToPdf` y `exportToExcel` usan ese encabezado. Si falla la carga de una imagen, **se cancela la descarga** y el error se
  muestra al usuario (nunca se descarga un reporte a medias). La compresión de imágenes redujo los PDF de muestra de ~4,5 MB a ~100 KB con un encabezado idéntico píxel a píxel.
- **Las exportaciones ahora se esperan (`await`)** en todos los llamadores (servicios y manejadores de la interfaz): se corrigieron promesas de Excel descartadas en las
  pestañas de sesiones y transacciones, y el estado "ocupado" ya no se limpia antes de terminar. Al portar, revisar que cada botón de exportar espere la promesa.
- Los activos `dvem-logo.png`, `dvem-logo-inverted.png` y `qr.svg` son de DVEM: **reemplazar por los de este proyecto**. El `qr.svg` es una ilustración de
  teléfono con QR, no un código generado ni validado; no se agregó generación dinámica de QR ni enlaces para compartir reportes.

**Verificación en DVEM.** Con tests de vitest (RED observado y luego GREEN: cargador, PDF real con jsPDF/AutoTable, Excel real con ExcelJS: 2/8/28 columnas, imágenes
incrustadas, anclas, encabezados, metadatos, totales, impresión, falla sin descarga y reintento), suite completa (101 archivos, 789 tests, 1 salteado previo), lint sin
errores y build correcto. Además se generaron PDF (vertical y horizontal, varias páginas) y Excel (angosto y ancho) con datos sintéticos y se inspeccionaron
convertidos con LibreOffice. **No se verificó** en un navegador conectado, en móviles ni en Microsoft Excel nativo.


| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/admin/components/settings/environment/EnvironmentTypesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/environment/EnvironmentTypesTable.tsx` |  |
| `frontend/src/admin/components/settings/financial/IdentificationTypesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/financial/IdentificationTypesTable.tsx` |  |
| `frontend/src/admin/components/settings/location/CitiesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/location/CitiesTable.tsx` |  |
| `frontend/src/admin/components/settings/location/CountriesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/location/CountriesTable.tsx` |  |
| `frontend/src/admin/components/settings/location/StatesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/location/StatesTable.tsx` |  |
| `frontend/src/admin/components/settings/tax/TaxTypesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/tax/TaxTypesTable.tsx` |  |
| `frontend/src/admin/components/users/UsersTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/UsersTable.tsx` |  |
| `frontend/src/admin/components/users/__tests__/UsersTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/__tests__/UsersTable.test.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` |  |
| `frontend/src/app/components/dispensers/DispensersTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/dispensers/DispensersTable.tsx` | ⚠ exportador de la tabla de dispensers: adaptar columnas |
| `frontend/src/app/components/environments/EnvironmentsTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentsTable.tsx` |  |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: conservar solo el patron (selector de dispositivos vinculados/desvinculados y pulso) |
| `frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.tsx` |  |
| `frontend/src/app/services/device.service.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/device.service.test.ts` | ⚠ tipos y llamadas con importe/moneda/comisiones |
| `frontend/src/app/services/device.service.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/device.service.ts` | ⚠ tipos y llamadas con importe/moneda/comisiones |
| `frontend/src/app/services/environment.service.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/services/environment.service.ts` | ⚠ solo cambia la espera (await) de la exportacion |
| `frontend/src/components/dashboard/dispenser/ExportLifecycle.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/dispenser/ExportLifecycle.test.tsx` |  |
| `frontend/src/components/dashboard/dispenser/SessionsTab.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/dispenser/SessionsTab.tsx` | ⚠ exporta sesiones de cobro: adaptar a lecturas |
| `frontend/src/components/dashboard/dispenser/TransactionsTab.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/dispenser/TransactionsTab.tsx` | ⚠ exporta transacciones de cobro: adaptar a lecturas |
| `frontend/src/lib/export.excel.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/export.excel.test.ts` |  |
| `frontend/src/lib/export.utils.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/export.utils.test.ts` |  |
| `frontend/src/lib/export.utils.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/lib/export.utils.ts` |  |
| `frontend/src/lib/report-branding.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/report-branding.test.ts` |  |
| `frontend/src/lib/report-branding.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/report-branding.ts` |  |

Las tablas de administración que aparecen en la lista (`EnvironmentTypesTable`, `CitiesTable`, `CountriesTable`, `StatesTable`, `TaxTypesTable`, `UsersTable`, etc.)
solo cambian para esperar la exportación y mostrar el error: es el mismo patrón en todas. En este proyecto aplicarlo a las tablas que exista.

## 16. Último login y última actividad de los usuarios, visibles en el admin

**Problema.** No había registro de cuándo un usuario inició sesión por última vez ni de quién usa la aplicación. Además la sesión vive en una cookie de refresco que el
frontend renueva cada ~90 s, así que un `last_login_at` solo parecería viejo para quien mantiene la sesión abierta: hace falta también una marca de actividad.

**Solución.**
- Dos columnas nuevas y **nullable** en la tabla `user`: `last_login_at` y `last_seen_at`, del mismo tipo que `created_at`/`updated_at` (timestamp sin zona horaria), **sin relleno**
  (`NULL` = sin registro).
- **`last_login_at`** (y también `last_seen_at`) se guarda en cada **login exitoso**: contraseña y SSO (Google/Facebook), en un método `record_login` del servicio de autenticación.
  Un login fallido no escribe nada, y si la escritura falla se registra un aviso y **nunca rompe el login**.
- **`last_seen_at`** se marca desde `get_current_user` (todo pedido autenticado), **como máximo cada 15 minutos por usuario**: primero una comprobación en memoria sobre la fila ya
  cargada; si está vencida, **un solo `UPDATE` condicional** (`... WHERE id = :id AND (last_seen_at IS NULL OR last_seen_at <= :ahora - 15 min)`), que evita escrituras dobles con
  pedidos simultáneos. Tras escribir se refleja el valor en el objeto cargado con `set_committed_value` para no dejarlo "sucio". Si falla, aviso en el log y el pedido sigue.
- API: `lastLoginAt` y `lastSeenAt` en la respuesta de usuarios (no se pueden escribir desde el cliente), y la lista admite ordenar por ambos con NULL al final.
- Frontend (admin, lista de usuarios): columna **"Último acceso"** con texto relativo corto ("hace 3 días", o "Nunca" si no hay registro) de `lastSeenAt ?? lastLoginAt`, y un **tooltip** (accesible
  con teclado) con las fechas exactas `dd/MM/yyyy HH:mm`: **Creado**, **Actualizado**, **Último login** y **Última actividad** ("—" si falta). Se ordena por esa columna; hay también la opción
  "Último login"; la tarjeta móvil muestra el texto y las cuatro fechas (en táctil no hay tooltip) y la exportación incluye la columna.

**Trampas que hay que respetar (verificadas en DVEM y presentes también aquí):**
1. **`updated_at` se rompe solo.** En `User`, `updated_at` tiene `sa_column_kwargs={"onupdate": func.now()}`: cualquier `UPDATE` del ORM lo modifica. Guardar los timestamps nuevos
   con el método normal haría que "Actualizado" cambie en cada login. Los dos métodos del repositorio (`touch_login`, `touch_seen`) usan `UPDATE` de Core que **fija `updated_at` a sí mismo**
   (`updated_at=tabla.c.updated_at`), y hay tests contra PostgreSQL que lo comprueban (con la protección quitada, fallan).
2. **`created_at` tiene un error de origen que este proyecto también tiene** (`backend/app/api/auth/models.py`, línea ~36: `created_at: datetime = Field(default=datetime.now())`, con paréntesis):
   la fecha se calcula **una sola vez al importar el módulo**, y todos los usuarios creados mientras el proceso está vivo reciben la hora de arranque. En DVEM había usuarios con el mismo `created_at`
   hasta el microsegundo. Corregirlo con `Field(default_factory=datetime.now)`. Las fechas ya guardadas mal no se pueden recuperar.
3. **Zona horaria.** Las fechas son naive (hora local del proceso) y el frontend interpreta las fechas sin zona como UTC: solo es correcto si el servidor y la base corren en UTC (en DVEM
   los contenedores están en UTC). Verificarlo aquí.
4. **La tabla `user` en DVEM no tiene RLS**, por lo que estas escrituras con la sesión sin identidad funcionan. **Comprobar que en este proyecto también sea así**; si hay RLS sobre `user`, las
   escrituras deben usar la sesión de sistema.
5. **Migración:** crear una revisión nueva **encadenada a la cabeza real de este proyecto** (hoy `z8a9b0c1d2e3`, no el identificador de DVEM `v7w8x9y0z1a2`), con `upgrade` y `downgrade`. **Orden de despliegue: migrar
   primero (`alembic upgrade head`) y recién después levantar el backend nuevo**; si el código nuevo corre sin la migración, toda consulta de usuarios falla con `column user.last_login_at does not exist`
   (pasó en el entorno local de DVEM).

**Verificación en DVEM.** Tests de API con SQLite (login exitoso, login fallido, SSO, limitación de 15 minutos medida con un contador de sentencias SQL, fallo de la escritura sin romper el pedido,
fechas de creación distintas), tests de migración y **tests contra PostgreSQL real** (columnas, `updated_at` intacto con y sin valor previo, un `UPDATE` normal sí lo modifica, dos llamadas simultáneas escriben una
sola vez, límites de 14 y 15 minutos). Frontend: 7 tests (texto relativo, respaldo a `lastLoginAt`, "Nunca", tooltip con las cuatro fechas por teclado, tarjeta móvil, orden y exportación).
No se probó en un navegador real.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/alembic/versions/v7w8x9y0z1a2_add_user_activity_timestamps.py` | nuevo | `/home/martin/Code/DVEM-App/backend/alembic/versions/v7w8x9y0z1a2_add_user_activity_timestamps.py` | ⚠ re-encadenar a la cabeza real de este proyecto (`z8a9b0c1d2e3`) y cambiar el identificador |
| `backend/app/api/auth/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/models.py` |  |
| `backend/app/api/auth/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/repository.py` |  |
| `backend/app/api/auth/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/router.py` | ⚠ solo cambian la lista blanca de campos de orden y las llamadas a `record_login` en los callbacks SSO |
| `backend/app/api/auth/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/auth/service.py` |  |
| `backend/app/core/dependencies.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/core/dependencies.py` | ⚠ aquí ya existe `get_current_user`: agregar `_touch_last_seen` y el intervalo de 15 minutos |
| `backend/tests/alembic/test_user_activity_revision.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/alembic/test_user_activity_revision.py` |  |
| `backend/tests/api/test_user_activity.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/test_user_activity.py` |  |
| `backend/tests/postgres/test_user_activity.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/postgres/test_user_activity.py` |  |
| `frontend/src/admin/components/users/UserLastAccess.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/UserLastAccess.tsx` |  |
| `frontend/src/admin/components/users/UsersTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/UsersTable.tsx` |  |
| `frontend/src/admin/components/users/__tests__/UsersTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/users/__tests__/UsersTable.test.tsx` |  |
| `frontend/src/interfaces/user.interface.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/interfaces/user.interface.ts` |  |
| `frontend/src/utils/date.utils.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/utils/date.utils.ts` | ⚠ aquí ya existe: agregar `formatRelativeTime` (usa `date-fns` con el idioma `es`) |

## 17. Estándar de pantallas de listado (buscador, filtros, exportar y encabezados)

**Qué se unificó.** Todas las listas de DVEM ahora se ven y se comportan igual (referencia: Establecimientos y Dispositivos). **Este proyecto debe adoptar el mismo criterio en todas sus listas:**
1. **Buscador** `Buscar en todos los campos...` que busca en **todas** las columnas que se muestran; en pantallas con paginación en el servidor, la búsqueda se hace en el servidor.
2. **Botón "Filtros"** que abre un panel con los filtros de esa pantalla y un "Limpiar todos" (visible solo si hay filtros activos).
3. **Fila de exportación** con dos botones, **Excel** y **PDF**, alineada a la derecha, entre la barra de herramientas y la tabla (no dentro de la barra ni dentro del encabezado de una tarjeta). Botones chicos con borde, ícono verde (Excel) y rojo (PDF), y el texto oculto en pantallas chicas. **Exporta todas las filas que coinciden con la búsqueda y los filtros**, no solo la página visible.
4. **Tabla:** encabezados **centrados**; las columnas ordenables usan `DataTableColumnHeader` con el ícono de orden junto al título; celdas centradas; tarjetas en móvil (debajo de `md`).
5. **Paginación** siempre con `DataTablePagination`; el estado (página, tamaño, búsqueda, filtros y orden) se guarda en el URL.

**Piezas compartidas (copiarlas y usarlas en cada lista):**
- `ListSearchInput` — `{ value, onChange, onClear, placeholder = "Buscar en todos los campos...", ariaLabel?, className? }`; botón de limpiar accesible y altura táctil de 44 px.
- `ListExportActions` — `{ onExport("excel" | "pdf"): Promise<void>, disabled? }`; maneja el estado "exportando" y muestra `toast.error("Error al generar el reporte")` si falla.
- `ListFiltersTrigger` y `ListFiltersPanel` (en `ListFiltersAccordion.tsx`) con el hook `useListFilters()`; `ListFilterFields` trae campos listos (select, número con `min`, texto).
- `useDebouncedSearch(inicial, demora = 300)` devuelve `{ value, debounced, setValue, clear }` (usa `useDebouncedValue`, del cambio 7).
- `fetchAllPages(fetchPage, { perPage = 10000 })` para exportar: pide la página 1 y sigue mientras `total` lo indique; se detiene ante una página vacía.
- `serverSorting` traduce el orden de la tabla a `sort_by`/`sort_order` del servidor (con `manualSorting`) y cae al orden por defecto ante un reinicio o una columna desconocida.
- `downloadReport` arma el Excel/PDF (horizontal si hay más de 6 columnas); `utils/url-params.ts` trae `toPositiveInt` para leer `page` y `size` del URL sin producir valores inválidos.
- `DataTableColumnHeader` acepta `align="start" | "center" | "end"`; `CenteredHeader` es para columnas que no se ordenan; `CENTERED_CELL_CLASS` (`text-center`) va en las celdas.

**Trampas que ya nos pasaron:**
1. **Exportar cortaba en 100 filas sin avisar.** El paginador compartido del backend (`backend/app/services/pagination.py`) limitaba `per_page` a 100 con `MAX_PER_PAGE = 100`, pero las exportaciones piden 1000 o 10000 filas. Subirlo a **10000** (y su test). Revisar en este proyecto que **ninguna ruta** de listado tenga un `le=100` propio (en DVEM quedó solo una de reportes).
2. **Tablas de TanStack con datos del lado del cliente:** si `data` es un array nuevo en cada render, la tabla reinicia la página y "siguiente" nunca avanza. Usar `autoResetPageIndex: false` y `useMemo` para los datos filtrados. Si el URL pide una página más allá de la última, mostrar la última y corregir el URL con `replace` (solo cuando ya hay filas, para no perder la página mientras cargan los datos).
3. **`page`, `size` y filtros numéricos vienen del URL:** validar. `page=abc` o `size=0` dejaba la tabla vacía sin error (el backend responde 422); un monto mínimo negativo también. Mostrar un cuadro de error con "Reintentar" cuando la consulta falla.
4. **Búsqueda con fechas:** el servidor necesita `utc_offset_minutes = -new Date().getTimezoneOffset()` para comparar las fechas como las ve el usuario; enviarlo siempre que haya búsqueda **o filtro de fechas**, si no el mismo filtro da resultados distintos según haya texto o no.
5. **No hay endpoints de exportación en el servidor:** la exportación vuelve a pedir las filas con `per_page` grande y arma el archivo en el navegador, por eso el tope de 10000 importa.
6. **Búsqueda y `LIKE`:** recortar, limitar a 64 caracteres y escapar `%`, `_` y `\`.
7. **`tsc -b`:** el `build` local (`npm run build`) corre `tsc -b`, que también revisa los tests: un `import` sin usar en un test lo rompe (el `Dockerfile` de DVEM usa `npx vite build` y no lo detecta). Correr `tsc --noEmit -p tsconfig.app.json` antes de mergear.

**Cómo aplicarlo a cada lista de este proyecto:** inventariar las pantallas con tablas y, para cada una, comprobar los cinco puntos de arriba; las que difieran se alinean con las piezas compartidas. No reescribir las pantallas de referencia salvo para cambiar las piezas por las compartidas.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/custom/ListSearchInput.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListSearchInput.tsx` |  |
| `frontend/src/components/custom/ListSearchInput.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListSearchInput.test.tsx` |  |
| `frontend/src/components/custom/ListExportActions.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListExportActions.tsx` |  |
| `frontend/src/components/custom/ListExportActions.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListExportActions.test.tsx` |  |
| `frontend/src/components/custom/ListFiltersAccordion.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListFiltersAccordion.tsx` |  |
| `frontend/src/components/custom/ListFiltersAccordion.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListFiltersAccordion.test.tsx` |  |
| `frontend/src/components/custom/ListFilterFields.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListFilterFields.tsx` | campos de filtro reutilizables (select, número y texto) |
| `frontend/src/components/custom/ListFilterFields.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ListFilterFields.test.tsx` |  |
| `frontend/src/hooks/useListFilters.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useListFilters.ts` |  |
| `frontend/src/hooks/useDebouncedSearch.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useDebouncedSearch.ts` | depende de `hooks/useDebouncedValue.ts`, que este proyecto todavía no tiene (viene con el cambio 7) |
| `frontend/src/hooks/useDebouncedSearch.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useDebouncedSearch.test.tsx` |  |
| `frontend/src/lib/fetchAllPages.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/fetchAllPages.ts` |  |
| `frontend/src/lib/fetchAllPages.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/fetchAllPages.test.ts` |  |
| `frontend/src/lib/serverSorting.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/serverSorting.ts` |  |
| `frontend/src/lib/serverSorting.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/serverSorting.test.ts` |  |
| `frontend/src/lib/downloadReport.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/downloadReport.ts` |  |
| `frontend/src/lib/downloadReport.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/lib/downloadReport.test.ts` |  |
| `frontend/src/utils/url-params.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/utils/url-params.ts` |  |
| `frontend/src/utils/url-params.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/utils/url-params.test.ts` |  |
| `frontend/src/components/custom/tableAlignment.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/tableAlignment.ts` |  |
| `frontend/src/components/custom/CenteredHeader.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/CenteredHeader.tsx` |  |
| `frontend/src/components/custom/CenteredHeader.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/CenteredHeader.test.tsx` |  |
| `frontend/src/components/custom/DataTableColumnHeader.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/DataTableColumnHeader.tsx` | ⚠ aquí ya existe: agregar la opción `align="center"` (el valor por defecto no cambia) |
| `frontend/src/components/custom/DataTableColumnHeader.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/DataTableColumnHeader.test.tsx` |  |
| `backend/app/services/pagination.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/services/pagination.py` | ⚠ aquí ya existe: subir `MAX_PER_PAGE` a 10000 (ver trampa 1) |
| `backend/tests/test_pagination_logic.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/test_pagination_logic.py` |  |

Pantallas de DVEM que ya usan el estándar (referencia de uso; las marcadas con ⚠ contienen lógica de pagos):

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/components/environments/EnvironmentsTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentsTable.tsx` |  |
| `frontend/src/app/components/environments/EnvironmentsTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentsTable.test.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.test.tsx` |  |
| `frontend/src/admin/components/permissions/PermissionsTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/permissions/PermissionsTable.tsx` |  |
| `frontend/src/admin/components/permissions/PermissionsTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/permissions/PermissionsTable.test.tsx` |  |
| `frontend/src/admin/pages/permissions/PermissionsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/permissions/PermissionsPage.tsx` |  |
| `frontend/src/admin/pages/permissions/PermissionsPage.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/permissions/PermissionsPage.test.tsx` |  |
| `frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | ⚠ pantalla de pagos de un dispositivo: usar solo como ejemplo de búsqueda/filtros/exportación en servidor |
| `frontend/src/app/pages/devices/DeviceOperationsPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.test.tsx` |  |
| `frontend/src/app/components/devices/DeviceOperationsResults.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceOperationsResults.tsx` | ⚠ pantalla de pagos: solo el patrón (tarjetas móviles + tabla centrada) |
| `frontend/src/app/components/devices/deviceOperationsColumns.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/deviceOperationsColumns.tsx` | ⚠ columnas de pagos: solo el patrón de columnas ordenables en servidor |

Las tablas de Mercado Pago de DVEM también adoptaron este estándar, pero **no se portan**.

## 18. Botón "Volver" unificado (flecha con borde al lado del título)

**Criterio.** En **todas** las pantallas que tienen un control para volver, se muestra el mismo botón: un cuadrado con borde y una flecha a la izquierda, **al lado del título y el subtítulo** de la página (como en "Nuevo Establecimiento"). **Sin el texto "Volver" a la vista.**

**Cómo quedó.** Componente compartido `BackButton`: botón con borde `size-11` (44 px), solo la flecha, nombre accesible "Volver" (se puede cambiar, por ejemplo "Volver a países"); se dibuja como enlace si recibe `to` y como botón si recibe `onClick`. `PageHeader` lo usa cuando recibe `backUrl` (antes mostraba un enlace "‹ Volver" arriba); `FormPageLayout` (crear/editar) también, y varias páginas que armaban su propia flecha, algunas **sin nombre accesible** y con un área táctil de 36 px, pasaron al mismo componente.

**Qué no se cambió a propósito:** los botones de abajo de los formularios ("Volver" en lugar de "Cancelar"), los enlaces de texto ("Volver al inicio", "Volver al listado") y los pasos hacia atrás de diálogos.

**Trampa:** los tests que buscaban el texto "Volver" deben buscar el botón accesible por su nombre; si una pantalla tiene también el botón de abajo, hay dos elementos con ese nombre.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/custom/BackButton.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/BackButton.tsx` |  |
| `frontend/src/components/custom/BackButton.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/BackButton.test.tsx` |  |
| `frontend/src/app/components/PageHeader.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/PageHeader.tsx` | ⚠ aquí ya existe: mostrar `BackButton` al lado del título en vez del enlace "‹ Volver" |
| `frontend/src/app/components/PageHeader.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/PageHeader.test.tsx` |  |
| `frontend/src/components/custom/FormPageLayout.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/FormPageLayout.tsx` | ⚠ aquí ya existe: reemplazar su flecha propia por `BackButton` |
| `frontend/src/app/pages/environments/CreateEnvironmentPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/environments/CreateEnvironmentPage.tsx` |  |
| `frontend/src/admin/components/settings/location/LocationManager.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/settings/location/LocationManager.tsx` |  |
| `frontend/src/admin/pages/users/CreateUserPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/users/CreateUserPage.tsx` |  |
| `frontend/src/admin/pages/users/EditUserPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/users/EditUserPage.tsx` |  |
| `frontend/src/admin/pages/settings/financial/CreateIdentificationTypePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/financial/CreateIdentificationTypePage.tsx` |  |
| `frontend/src/admin/pages/settings/financial/EditIdentificationTypePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/financial/EditIdentificationTypePage.tsx` |  |
| `frontend/src/admin/pages/settings/location/CreateCityPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/CreateCityPage.tsx` |  |
| `frontend/src/admin/pages/settings/location/EditCityPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/EditCityPage.tsx` |  |
| `frontend/src/admin/pages/settings/location/CreateCountryPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/CreateCountryPage.tsx` |  |
| `frontend/src/admin/pages/settings/location/EditCountryPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/EditCountryPage.tsx` |  |
| `frontend/src/admin/pages/settings/location/CreateStatePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/CreateStatePage.tsx` |  |
| `frontend/src/admin/pages/settings/location/EditStatePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/location/EditStatePage.tsx` |  |

## 19. Selector de rango de fechas en móvil

**Problema.** El selector de rango de fechas (`components/ui/date-range-picker.tsx`, exportado como `DateRangePicker` y `DatePickerWithRange`) tiene la propiedad `mobileLayout`. Con ella, en pantallas chicas (menos de 960 px) se abre como **diálogo a pantalla completa** ("Seleccionar rango de fechas", con Desde, Hasta, calendario y los botones Cancelar y Actualizar). Sin ella se abre como un popover apretado que queda cortado abajo (con "Cancelar" y "Actualizar" tapados). El dashboard la pasaba, pero las pantallas de pagos e historial no.

**Criterio.** **Toda pantalla que use el selector debe pasar `mobileLayout` y `triggerClassName="w-full sm:w-auto"`.** En DVEM son cuatro: el dashboard, "Pagos" de un dispositivo, el historial de un dispositivo y el filtro "Última actividad" del historial de dispositivos. En este proyecto: buscar con `rg -n "DatePickerWithRange|<DateRangePicker"` y corregir todas.

**La fila de filtros en móvil:** buscador a ancho completo arriba y selector de fechas a ancho completo debajo (`flex flex-col gap-2 sm:flex-row sm:items-center`); en escritorio queda como antes. En las pantallas de historial, el selector va **a la derecha del botón "Filtros"**.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | ⚠ pantalla de pagos: solo la parte del selector de fechas y la fila de filtros |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` |  |
| `frontend/src/app/pages/devices/FormerDevicesPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.tsx` |  |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: es la referencia de cómo se pasa `mobileLayout`; no portar el resto |

## 20. Panel inferior del mapa en móvil

**Problema.** En el celular (414 px) el globo de Google (`InfoWindow`) del mapa queda chico y cortado: el botón "Ver detalles" se tapa y hay una barra de desplazamiento adentro.

**Solución.** Por debajo de 768 px (`md`), al tocar un marcador **no** se muestra el `InfoWindow`: se abre un **panel inferior** (`Sheet` de `components/ui/sheet.tsx`, `side="bottom"`) con el título (el nombre del dispositivo si hay uno solo, o la dirección si son varios), la dirección y la ciudad una sola vez, y un bloque por dispositivo con su estado, sus alertas y su botón "Ver detalles" a ancho completo (`min-h-11`). Alto máximo `70vh` con desplazamiento. Al cerrarlo se limpia la selección. En `md` o más se mantiene el `InfoWindow`. El punto de corte lo da el hook `useMediaQuery(query)` (`useSyncExternalStore` sobre `matchMedia`, con valor por defecto `false` cuando no existe `matchMedia`, para tests y renderizado en servidor).

**Detalle:** el `Sheet` es modal (la capa cubre el mapa), así que "tocar otro marcador" equivale a cerrar y volver a tocar. Su botón de cierre tiene una etiqueta oculta en inglés ("Close"): traducirla al adaptar el componente.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/dashboard/map/MapContainer.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.tsx` | ⚠ aquí ya existe: agregar el panel inferior (`Sheet`) para pantallas chicas |
| `frontend/src/components/dashboard/map/MapContainer.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/map/MapContainer.test.tsx` |  |
| `frontend/src/hooks/useMediaQuery.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useMediaQuery.ts` |  |
| `frontend/src/hooks/useMediaQuery.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useMediaQuery.test.tsx` |  |

## 21. Etiquetas en español y búsqueda por etiqueta (patrón)

**Problema.** La aplicación mostraba códigos crudos del backend o de proveedores (`success`, `interop_transfer`, `accredited`, estados de dispositivos, etc.).

**Criterio.** **Todo valor de un vocabulario fijo que se muestre al usuario pasa por un módulo central de etiquetas**, con un respaldo que "humaniza" cualquier código desconocido (`weird_state` → "Weird state"; nunca mostrar un código crudo en mayúsculas o con guiones bajos). Solo cambia lo que se **muestra**: los valores enviados a la API, los parámetros del URL y los filtros no se traducen. Los PDF y Excel usan las mismas etiquetas que la pantalla.

**Cómo quedó.** `utils/status-labels.ts`: un mapa por vocabulario, `labelFrom` (sin distinguir mayúsculas, recortando espacios, **leyendo solo propiedades propias** para que códigos como `constructor` o `__proto__` no devuelvan miembros heredados, y aceptando valores que no son texto) y `humanizeCode`. **Los mapas concretos de DVEM son de pagos (métodos, estados, detalles de rechazo) y no se portan**: hay que armar los de este proyecto (estados de dispositivos, tipos de operación, estados de invitaciones, etc.).

**Búsqueda por etiqueta.** Si el buscador es del servidor, el usuario escribe lo que ve ("aprobado"), no el código. Solución: el backend tiene una copia de los mapas en español (`labels_es.py`) y una función pura `codes_matching_label(termino, mapa)` que, sin distinguir tildes ni mayúsculas, devuelve los códigos cuya etiqueta contiene el término; la búsqueda agrega `lower(cast(columna, String)) IN (codigos)` al `ILIKE` sobre el valor crudo. Como los mapas están duplicados, **hay un test que lee el archivo del frontend y falla si difieren** (se omite si el frontend no está presente). Los montos escritos como se muestran (`$1.500,00`) también se normalizan y se buscan (eso es de pagos).

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/utils/status-labels.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/utils/status-labels.ts` | ⚠ los mapas de pagos NO se portan: copiar solo el patrón (`labelFrom`, `humanizeCode`) y armar los mapas de este proyecto |
| `frontend/src/utils/status-labels.test.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/utils/status-labels.test.ts` |  |
| `backend/app/api/device/history/labels_es.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/labels_es.py` | ⚠ mapas de pagos: copiar solo el patrón `codes_matching_label` y el test de paridad con el frontend |
| `backend/tests/api/device/test_history_labels_es.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_history_labels_es.py` |  |
| `backend/app/api/device/history/query_utils.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/query_utils.py` | ⚠ `label_search` reutilizable; `amount_search` es de pagos |
| `frontend/src/components/dashboard/dispenser/TransactionsTab.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/dashboard/dispenser/TransactionsTab.tsx` |  |
| `frontend/src/app/components/environments/EnvironmentDetailDialog.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentDetailDialog.tsx` |  |
| `frontend/src/app/invitations/InvitationAcceptPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/invitations/InvitationAcceptPage.tsx` |  |
| `frontend/src/app/invitations/InvitationAcceptPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/invitations/InvitationAcceptPage.test.tsx` |  |
| `frontend/src/app/components/access/EnvironmentGuestManagementCard.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/access/EnvironmentGuestManagementCard.tsx` |  |

## 22. Historial de dispositivos y de un dispositivo, con búsqueda, filtros y exportación

**Qué es.** Dos pantallas de solo lectura sobre dispositivos que ya no pertenecen al establecimiento del usuario (cambios 2 y 3), llevadas al estándar del cambio 17:
- **Historial de dispositivos** (`FormerDevicesPage`, `/app/devices/history`): buscador en todos los campos (serie, establecimiento, fechas, contadores), filtros (establecimiento, rango de última actividad, solo con pagos), exportar Excel/PDF de todas las filas filtradas, encabezados centrados con orden desde el servidor y tarjetas en móvil.
- **Historial de un dispositivo** (`FormerDeviceHistoryPage`, `/app/devices/history/:serial`): el selector de fechas a la derecha de "Filtros", y por pestaña buscador, filtros, exportación, orden y tarjetas en móvil.

**Para este proyecto la parte valiosa es la de telemetría.** En DVEM la pestaña de **Telemetría** (lecturas de sensores) se terminó ocultando de la interfaz por decisión del dueño (quedan los datos, los endpoints y el componente), pero **para un proyecto de monitoreo ambiental las lecturas son el contenido principal**: `HistoryTelemetryTab` y `ReadingMobileCards` son la plantilla lista para usar, con búsqueda en todos los campos, filtros (alimentación, estado del agua, relés, solo con error, firmware, temperatura mínima y máxima), orden (tiempo, temperatura, firmware, intensidad de señal) y exportación de todas las filas filtradas. **Reemplazar las columnas y filtros por las magnitudes de este proyecto** (temperatura, humedad, etc.).

**Backend** (`backend/app/api/device/history/*`): parámetros opcionales nuevos en `GET /devices/history/devices` (`search`, `last_seen_from/to`, `has_payments`, `sort_by`, `sort_order`), en `.../{serial}/operations` (`search`, `payment_status`, `payment_method`, `amount_min/max`, `sort_by`, `sort_order`) y en `.../{serial}/sensor-readings` (`search`, `water_state`, `power_supply_state`, `relay_water`, `relay_heater`, `has_error`, `firmware_version`, `temp_min/max`, `sort_by`, `sort_order`); todos aceptan `utc_offset_minutes` (entero entre -840 y 840) y `per_page` hasta 10000. La búsqueda es sin distinguir mayúsculas, recortada, limitada a 64 caracteres y con comodines escapados; el orden deja los valores vacíos al final en ambas direcciones, con `serial`/`time`/`id` como desempate. La lista se agrega primero y luego se busca, filtra, ordena y pagina, para que `total` y `pages` sean exactos. Las operaciones con pagos se reescribieron con **una sola consulta con unión** (antes hacían una consulta por fila): esa parte es de pagos, pero la idea sirve para cualquier lista enriquecida fila por fila. Todos los permisos del cambio 2 (dueño anterior, invitados, telemetría solo para miembros) se mantienen, y hay tests de PostgreSQL con el rol sin superusuario que lo comprueban.

**Trampas:** los estados `water_state`/`power_supply_state` llegan del backend como **booleanos** y el frontend los trataba como texto (habría fallado); mostrarlos como "Sí"/"No" o con las palabras del dominio. Cuando cada pestaña conserva su estado al cambiar (`forceMount` con `hidden`), acordarse de reiniciar la página al cambiar la búsqueda o los filtros (`useResettingPage`).

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/pages/devices/FormerDevicesPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.tsx` |  |
| `frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` |  |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | ⚠ en DVEM muestra solo Operaciones (pagos); aquí conviene mostrar Telemetría |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.mobile.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.mobile.test.tsx` |  |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.test.tsx` |  |
| `frontend/src/app/components/devices/HistoryTelemetryTab.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/HistoryTelemetryTab.tsx` | plantilla directa para la telemetría de este proyecto |
| `frontend/src/app/components/devices/HistoryTelemetryTab.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/HistoryTelemetryTab.test.tsx` |  |
| `frontend/src/app/components/devices/ReadingMobileCards.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/ReadingMobileCards.tsx` | tarjetas móviles de lecturas |
| `frontend/src/app/components/devices/readingFormat.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/readingFormat.ts` |  |
| `frontend/src/app/components/devices/historyTabState.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/historyTabState.ts` |  |
| `frontend/src/app/components/devices/historyErrors.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/historyErrors.ts` |  |
| `frontend/src/app/components/devices/HistoryOperationsTab.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/HistoryOperationsTab.tsx` | ⚠ pestaña de pagos: solo el patrón |
| `frontend/src/app/components/devices/HistoryOperationsTab.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/HistoryOperationsTab.test.tsx` |  |
| `frontend/src/api/deviceHistory.api.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.ts` |  |
| `frontend/src/api/deviceHistory.api.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.test.ts` |  |
| `backend/app/api/device/history/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/history/router.py` |  |
| `backend/app/api/device/history/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/history/service.py` |  |
| `backend/app/api/device/history/query_utils.py` | nuevo | `/home/martin/Code/DVEM-App/backend/app/api/device/history/query_utils.py` |  |
| `backend/app/api/device/operations/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/operations/router.py` | ⚠ parámetros de pagos: subir `per_page` a 10000 y agregar `search`/orden |
| `backend/app/api/device/operations/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/operations/service.py` | ⚠ unión con pagos: solo la idea de reemplazar consultas por fila con una consulta con unión |

## 23. Dispositivos: orden por propietario y establecimiento, y columna "Estado"

- La lista "Mis dispositivos" se puede ordenar por **Propietario**, **Establecimiento** y **Estado** (backend: nuevos criterios `environmentName` y `owner` en `GET /devices`, con `NULL` al final; el orden por propietario une con el dueño activo del establecimiento).
- La columna **"Conectividad" pasó a llamarse "Estado"** en escritorio y móvil.
- **Regla de dominio:** un establecimiento tiene **un solo propietario** y varios invitados; con eso la unión por el dueño activo no duplica filas. Si este proyecto permitiera varios dueños, ordenar con una subconsulta escalar (`min(...)`) en vez de la unión.
- Para administradores, "Operaciones" también aparece en las acciones de la lista y tiene una ruta segura (`/admin/devices/:id/operations`, con destino de "Volver" correcto).

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.test.tsx` |  |
| `frontend/src/app/types/device.types.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/types/device.types.ts` |  |
| `backend/app/api/device/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/repository.py` | ⚠ aquí ya existe: agregar los criterios de orden `environmentName` y `owner` |
| `backend/app/api/device/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/router.py` |  |
| `frontend/src/router/app.router.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/router/app.router.tsx` | ⚠ solo la ruta de operaciones para administradores |
| `frontend/src/router/app.router.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/router/app.router.test.tsx` |  |

## 24. Alineaciones menores de pantallas

- **Establecimientos:** la barra de herramientas queda en **una sola fila** como en Usuarios, con columnas ordenables desde el servidor para los campos admitidos, manteniendo celdas centradas y exportaciones.
- **Permisos:** placeholder estándar, filas de Excel y PDF con todas las filas filtradas y ordenadas, y el contenido dentro de `PageHeader` (igual que Dispositivos) para que el espacio entre título y barra sea el de las demás pantallas.
- **Altura de controles:** todos los controles de la barra de herramientas (buscador, "Filtros", acciones, selector de fechas) miden **44 px**, como en Establecimientos; la barra de dispositivos se armó con los mismos componentes compartidos.
- Estas alineaciones están incluidas en las tablas del cambio 17.

---

## 25. Modo claro/oscuro persistente

**Problema.** DVEM no tenía selector de tema, pero **el CSS del modo oscuro ya estaba definido** (variables shadcn en `index.css`, `.dark { ... }`) sin que nada lo activara nunca. Al construir el toggle, apareció una serie de fondos y colores **hardcodeados** (`bg-white`, `bg-gray-*`, `bg-slate-*`, texto fijo) en vez de los tokens semánticos (`bg-background`, `bg-card`, `bg-muted`, `bg-sidebar`, etc.): al activar el oscuro, esos elementos se quedaban con su color fijo mientras el resto sí cambiaba, produciendo pantallas "a medio tematizar" (texto claro sobre fondo que seguía blanco, tarjetas sin contraste, el propio botón del toggle invisible por estar sobre un header que no cambiaba).

**Solución.**
- `useTheme` (hook): resuelve el tema desde `localStorage` (clave `dvem-theme`), cae a `prefers-color-scheme` si no hay nada guardado, y sigue la preferencia del sistema en vivo mientras el usuario no elija explícitamente. Aplica la clase `.dark` en `<html>`.
- `ThemeToggle` (componente): botón sol/luna que usa el hook; se colocó junto al menú de cuenta (`SidebarHeader`) y junto al enlace "Volver al inicio" en `AuthLayout` (login, registro, etc.), en la misma fila, para que ambos controles queden agrupados.
- Script inline en `index.html`, antes de montar React, que aplica el tema guardado/del sistema **antes del primer pintado** (evita el flash del tema incorrecto).
- Se reemplazaron los colores hardcodeados por tokens semánticos en el header y el menú lateral (aprovechando los tokens `sidebar-*` de shadcn, ya definidos y sin usar), el contenedor principal del layout, el selector de país, y varias tarjetas/paneles de dispositivos.
- Dos logos PNG (`dvem-logo.png`, `dvem-logo-inverted.png`) tenían el fondo (blanco y negro respectivamente) **horneado en el píxel**, no transparente: se "despremultiplicó" el color contra el fondo sólido conocido (técnica estándar cuando un asset se exportó compuesto sobre negro o blanco) para recuperar la transparencia real sin re-hacer el logo.
- El autofill de Chrome/Edge pinta el fondo de los inputs de amarillo **ignorando el CSS de la página**; se neutraliza con `box-shadow: 0 0 0px 1000px var(--background) inset` + `transition-delay` largo (evita el flash amarillo antes de que el override entre en efecto).

**Trampas:**
- Un componente puede usar `bg-background` en vez de `bg-transparent` como el resto de los inputs: `CountrySelect` quedaba con un tono más oscuro que la tarjeta que lo contenía, aunque técnicamente "seguía el tema".
- El ícono de un botón puede seguir el tema (color de texto) mientras su contenedor no — si eso pasa, el ícono se vuelve invisible por falta de contraste (pasó con el toggle sobre el header antes de tematizar el header).
- Si hay un componente compartido con logos/branding de terceros (ej. un proveedor de pagos) pensado solo para fondo claro, no intentar re-tematizarlo: ponerle un chip de fondo blanco propio es más simple y respeta los colores de marca.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/index.html` | modificado | `/home/martin/Code/DVEM-App/frontend/index.html` | script inline anti-flash |
| `frontend/src/hooks/useTheme.ts` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useTheme.ts` |  |
| `frontend/src/hooks/useTheme.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/hooks/useTheme.test.tsx` |  |
| `frontend/src/components/custom/ThemeToggle.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ThemeToggle.tsx` |  |
| `frontend/src/components/custom/ThemeToggle.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/components/custom/ThemeToggle.test.tsx` |  |
| `frontend/src/index.css` | modificado | `/home/martin/Code/DVEM-App/frontend/src/index.css` | override de autofill; el resto de las variables `.dark` ya deberían existir |
| `frontend/src/app/components/SidebarHeader.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/SidebarHeader.tsx` | agrega `ThemeToggle` y pasa sus colores a tokens semánticos |
| `frontend/src/app/components/SidebarHeader.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/SidebarHeader.test.tsx` |  |
| `frontend/src/app/layouts/MainLayout.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/layouts/MainLayout.tsx` | `bg-white` fijo → `bg-background` |
| `frontend/src/app/components/Sidebar.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Sidebar.tsx` | colores `gray-*` → tokens `sidebar-*`, logo centrado con grid de 3 columnas |
| `frontend/src/components/custom/CountrySelect.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/CountrySelect.tsx` | `bg-background` → `bg-transparent` (como el resto de los inputs) |
| `frontend/src/app/components/devices/DeviceEstablishmentBlock.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceEstablishmentBlock.tsx` |  |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` | panel "Filtros avanzados" |
| `frontend/src/app/components/devices/DeviceForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DeviceForm.tsx` | ⚠ bloque "Datos Técnicos": solo el token de fondo, el resto del formulario tiene campos de importe/comisiones (ver cambio 6) |
| `frontend/src/app/components/access/DeviceGuestManagementCard.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/access/DeviceGuestManagementCard.tsx` | tarjeta de invitación pendiente: tinte con opacidad en vez de color fijo |
| `frontend/src/auth/layouts/AuthLayout.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/layouts/AuthLayout.tsx` | agrega `ThemeToggle` junto al enlace de volver, en la misma fila |
| `frontend/src/auth/layouts/AuthLayout.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/auth/layouts/AuthLayout.test.tsx` |  |
| `frontend/src/app/pages/profile/ProfilePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.tsx` | ⚠ la tarjeta de Mercado Pago es de cobros y no se porta; solo sirve como ejemplo del patrón "chip blanco para un logo de marca ajena" si este proyecto tiene algo similar |
| `frontend/public/dvem-logo.png` | modificado (binario) | `/home/martin/Code/DVEM-App/frontend/public/dvem-logo.png` | técnica de "despremultiplicado" si el logo de este proyecto tiene el mismo problema; no copiar el archivo, es el logo de DVEM |
| `frontend/public/dvem-logo-inverted.png` | modificado (binario) | `/home/martin/Code/DVEM-App/frontend/public/dvem-logo-inverted.png` | ídem |

## 26. Reorganización del menú lateral y filtro de historial por propietario

**Problema.** "Dispositivos", "Historial de dispositivos" y "Usuarios" vivían escondidos dentro de "Ajustes"; un administrador no tenía forma directa de ver la vista simple que ve un usuario común, y las etiquetas del menú sugerían que el administrador era "dueño" de todos los dispositivos, cuando en realidad ve los de otros.

**Solución.**
- `Dispositivos`, `Vista de dispositivos` (solo admin, la misma tabla que ve un usuario común pero con visibilidad total), `Historial de dispositivos` y `Usuarios` se movieron de "Ajustes" a la raíz del menú. `Mapa` se movió justo debajo de "Inicio".
- Etiquetas corregidas para no afirmar posesión ("Vista de dispositivos" en vez de "Mis dispositivos" para el admin).
- El historial de dispositivos ganó, solo para administradores, filtro y orden por **propietario**, con el selector de Establecimiento **en cascada** al propietario elegido (si cambia el propietario, se resetea el establecimiento si ya no aplica). El campo `owner_id`/`owner_name` se expone únicamente cuando quien consulta es administrador.
- Tamaño de página por defecto del historial de dispositivos: **10**, no 20 (para que coincida con el resto de las listas del cambio 17).
- El historial de dispositivos **ya no tiene un rango de fechas por defecto**: mostraba "hoy" (un rango falso de un solo día) junto a la leyenda "Todas las fechas", que se contradecían. Otras pantallas que sí tienen un rango por defecto real se unificaron a **30 días** (hoy más los 29 anteriores).

**Trampa:** si se agrega un filtro nuevo con cascada a otro (propietario → establecimiento), acordarse de resetear también la página al cambiar cualquiera de los dos, y de invalidar la selección del hijo si deja de pertenecer al padre elegido.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/components/Sidebar.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Sidebar.tsx` | ver también el cambio 25 (colores) |
| `frontend/src/app/components/Sidebar.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Sidebar.test.tsx` |  |
| `frontend/src/app/pages/devices/UserDevicesPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/UserDevicesPage.tsx` | título/subtítulo según rol; se sacó el botón "Historial de dispositivos" (ya tiene entrada propia en el sidebar) |
| `frontend/src/app/pages/devices/UserDevicesPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/UserDevicesPage.test.tsx` |  |
| `backend/app/api/device/history/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/history/router.py` | parámetro `owner_id`, orden por `owner_name` |
| `backend/app/api/device/history/schemas.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/history/schemas.py` |  |
| `backend/app/api/device/history/service.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/history/service.py` |  |
| `backend/tests/api/device/test_history_owner_filter.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_history_owner_filter.py` |  |
| `frontend/src/api/deviceHistory.api.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.ts` |  |
| `frontend/src/api/deviceHistory.api.test.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/api/deviceHistory.api.test.ts` |  |
| `frontend/src/app/pages/devices/FormerDevicesPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.tsx` | filtro/orden por propietario en cascada, tamaño de página 10, sin rango de fechas por defecto |
| `frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDevicesPage.test.tsx` |  |
| `frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.tsx` | ⚠ pantalla de pagos: solo el default de 30 días |
| `frontend/src/app/pages/devices/DeviceOperationsPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/DeviceOperationsPage.test.tsx` |  |
| `frontend/src/app/pages/dashboard/MapPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/MapPage.tsx` | título/subtítulo acortados |
| `frontend/src/app/pages/dashboard/MapPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/MapPage.test.tsx` |  |

## 27. Pantallas de una sola tarjeta: flecha de "Volver" solo donde corresponde

**Problema.** El cambio 18 unificó el botón "Volver", pero `FormPageLayout` lo mostraba **siempre**, incluso en pantallas que ahora son raíz de una sección del sidebar (Mi Perfil, y cualquier pantalla de ajustes de una sola tarjeta): no tiene sentido un botón "Volver" en una pantalla a la que se llega directo desde el menú, igual que "Inicio" o "Mapa" no lo tienen. Además, esas pantallas de una sola tarjeta (Ajustes Generales, Cambiar Contraseña) no usaban `FormPageLayout` en absoluto: tenían su propio título de tamaño fijo (no escalaba en pantallas grandes como el resto) y un ancho limitado (`max-w-2xl`) en vez de ocupar todo el ancho disponible.

**Solución.**
- `FormPageLayout` ganó una prop opcional `hideBackButton` (por defecto `false`, no rompe los usos existentes) para las pantallas que son raíz de su sección: se las pasa por ese layout **sin** flecha.
- Regla para decidir: si la pantalla se llega **desde el sidebar**, sin flecha (Mi Perfil, Ajustes Generales, Historial de dispositivos). Si se llega desde un menú contextual (por ejemplo, "Cambiar Contraseña" desde el menú de cuenta), **con** flecha — sigue siendo una sub-pantalla, no una raíz.
- Ajustes Generales y Cambiar Contraseña migradas al layout compartido (título/subtítulo con la misma escala responsiva que el resto, ancho completo).

**Trampa de test:** si una pantalla usa `FormPageLayout` con acciones propias al pie ("Volver"/"Guardar"), y además el layout mostraba su propia flecha, un test que busca el botón "Volver" por nombre accesible puede encontrar **dos** elementos; con `hideBackButton` activo queda uno solo.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/custom/FormPageLayout.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/FormPageLayout.tsx` | ⚠ ya existe (cambio 18): agregar la prop `hideBackButton` |
| `frontend/src/app/pages/profile/ProfilePage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.tsx` | `hideBackButton` activo |
| `frontend/src/app/pages/profile/ProfilePage.layout.test.tsx` | nuevo | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ProfilePage.layout.test.tsx` |  |
| `frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/devices/FormerDeviceHistoryPage.tsx` | título con la misma escala responsiva que el resto |
| `frontend/src/admin/pages/settings/GeneralSettingsPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/pages/settings/GeneralSettingsPage.tsx` | ⚠ contiene comisiones y valores de cobro (no portar ese contenido); el patrón de layout (`FormPageLayout`, `hideBackButton`, campos en un mismo renglón con texto descriptivo) sí aplica a cualquier pantalla de ajustes de una sola tarjeta |
| `frontend/src/app/pages/profile/ChangePasswordPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/profile/ChangePasswordPage.tsx` | migrada a `FormPageLayout`, con flecha (se llega desde el menú de cuenta) |
| `frontend/src/app/components/Header.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/Header.tsx` | ítem del menú de cuenta renombrado de "Información Personal" a "Mi perfil", igual que en el sidebar |
| `frontend/src/app/components/SidebarHeader.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/SidebarHeader.tsx` | mismo cambio de etiqueta |

## 28. Dashboard: "Limpiar todos", selector de fechas sincronizado y una X de menos

**Problema.** El dashboard tenía sus propios filtros (fechas, usuario, establecimiento, dispositivo, moneda) pero no el botón "Limpiar todos" que ya tienen las demás listas del cambio 17. Al agregarlo apareció un bug más general: el selector de rango de fechas (`components/ui/date-range-picker.tsx`) solo lee sus props `initialDateFrom`/`initialDateTo` **al montarse** — es "no controlado" puertas adentro. Si el estado del padre cambia por otra vía que no sea el propio selector (por ejemplo, un botón que resetea el rango a los últimos 30 días), el selector se queda mostrando visualmente el valor viejo aunque el estado ya cambió.

**Solución.**
- Botón **"Limpiar todos"** (mismo texto, mismo estilo `variant="outline" size="sm"` que el resto de los paneles "Filtros avanzados" del cambio 17) que resetea establecimiento, dispositivo, propietario, moneda y el rango de fechas a su valor por defecto; visible solo si hay algún filtro activo.
- El `DateRangePicker` del dashboard recibe una `key` derivada del rango actual (`` `${from}|${to}` ``): al cambiar el rango por fuera del propio selector, React lo desmonta y remonta, y el selector vuelve a leer el valor correcto. El mismo problema (y la misma solución) ya existía resuelto en el selector de fecha del historial de un dispositivo por serial.
- El selector de usuario (`SearchableSelect`) tenía su propia X de "limpiar" individual que, junto al nuevo "Limpiar todos", quedaba redundante — y además nunca reflejaba un estado realmente "vacío" (su valor por defecto es la cadena `"all"`, no `undefined`, así que la X estaba siempre visible sin cumplir función real). Se agregó una prop `showClear` a `SearchableSelect` (por defecto `true`, no cambia ningún otro uso existente) para poder ocultarla puntualmente donde ya hay un "Limpiar todos" al lado.

**Trampa de test:** al usar la técnica de la `key` para forzar el remount de un selector no controlado, un test que guarda una referencia al elemento (`const picker = screen.getByRole(...)`) **antes** de una interacción que cambia esa `key`, y reutiliza esa misma variable después, queda con una referencia a un nodo que ya no está en el DOM. Hay que volver a consultar el elemento con `getByRole` después de cada interacción que pueda remontarlo, no reutilizar la variable.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/pages/dashboard/OverviewPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.tsx` | ⚠ dashboard de ingresos: es la referencia del patrón "Limpiar todos" + selector sincronizado, no portar el resto |
| `frontend/src/app/pages/dashboard/OverviewPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/pages/dashboard/OverviewPage.test.tsx` |  |
| `frontend/src/components/custom/SearchableSelect.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/custom/SearchableSelect.tsx` | ⚠ ya existe (cambio 7): agregar la prop `showClear` |

## 29. Auditoría "Buscar en todos los campos": paridad completa

*(Trabajo del otro agente.)*

**Contexto.** Siguiendo el criterio del cambio 17 ("el buscador busca en **todas** las columnas visibles"), se auditaron las 14 pantallas de listado del proyecto. 6 tenían el bug (algún campo visible que no entraba en la búsqueda); las otras 8 ya cumplían. **En este proyecto, al aplicar el estándar del cambio 17 a cada lista, conviene revisar explícitamente que cada columna mostrada esté cubierta por la búsqueda del servidor** — es fácil agregar una columna a la tabla y olvidarse de sumarla al filtro.

**Fixes de búsqueda:**
- **Establecimientos:** buscaba solo por nombre; ahora también por tipo, dueño, dirección y ubicación.
- **Permisos:** el filtro "Tipo" comparaba contra el booleano crudo (`true`/`false`) en vez del texto mostrado ("Básico"/"Opcional"); se corrigió con un `accessorFn` que expone la etiqueta visible en vez del valor crudo.
- **Provincias:** no buscaban por nombre de país (el `join` con país ya existía en el repositorio; solo faltaba usarlo en el filtro de búsqueda).
- **Tipos de documento y de condición fiscal:** no buscaban por nombre ni código de país. Se agregó un mapa `COUNTRY_CODE_LABELS` en cada repositorio, sincronizado a mano con `frontend/src/constants/supported-countries.ts`. **Trampa:** si este proyecto también tiene una lista central de países, el mismo patrón aplica, pero hay que mantener ambos lados sincronizados a mano (o generar uno desde el otro).

**Bugs encontrados al arreglar los tests relacionados, sin relación directa con el buscador — revisar si este proyecto los heredó de la misma base de código:**
- **Bug de datos real:** `LocationCityRead` no devolvía `postal_code` en absoluto, aunque la columna existe en el modelo — la columna "Código Postal" del listado de ciudades quedaba vacía siempre. Alcanza con revisar si el schema de lectura de ciudades de este proyecto tiene el mismo campo faltante.
- Dos suites de test legacy (`test_location.py`, `test_tax.py`) pegaban a rutas **sin** el prefijo `/api` (`/location/countries` en vez de `/api/location/countries`) y fallaban en el primer request, antes de llegar a ninguna aserción real — quedaron así sin que nadie lo notara. Se corrigieron las rutas y, de paso, dos aserciones que asumían un comportamiento viejo incorrecto: que un GET-by-id después de borrar debía dar 404, y que el listado sin filtro explícito debía ocultar los inactivos. Se confirmó contra el patrón real y consistente del resto del backend (por ejemplo `EnvironmentRepository.get_by_id`) que el comportamiento correcto es otro: GET-by-id siempre devuelve el registro aunque esté inactivo, y el listado sin `isActive` explícito trae todo (es el frontend quien pide `isActive=true` por defecto). **Si este proyecto heredó las mismas suites legacy, probablemente tenga el mismo bug de rutas** y valga la pena revisar esas mismas dos aserciones contra el comportamiento real, en vez de asumir cuál es "el correcto".
- Un `.pyc` de `alembic/__pycache__` había quedado trackeado en git; se sacó del control de versiones. Revisar que `__pycache__/` esté en el `.gitignore` de este proyecto.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/environment/environment/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/environment/environment/repository.py` | búsqueda por tipo, dueño, dirección y ubicación |
| `backend/tests/api/environment/test_environment_search.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/environment/test_environment_search.py` |  |
| `backend/tests/api/test_device.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/test_device.py` | cobertura del fix de dispositivos del cambio 5/6 que había quedado sin test propio |
| `frontend/src/admin/components/permissions/PermissionsTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/permissions/PermissionsTable.tsx` | `accessorFn` con la etiqueta visible del tipo |
| `frontend/src/admin/components/permissions/PermissionsTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/admin/components/permissions/PermissionsTable.test.tsx` |  |
| `backend/app/api/location/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/location/repository.py` | búsqueda de provincias por nombre de país |
| `backend/app/api/location/models.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/location/models.py` | `postal_code` en `LocationCityRead` — bug de datos, no de búsqueda |
| `backend/app/api/tax/identification_type/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/identification_type/repository.py` | `COUNTRY_CODE_LABELS` |
| `backend/app/api/tax/tax_type/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/tax/tax_type/repository.py` | `COUNTRY_CODE_LABELS` |
| `backend/tests/api/tax/test_country_catalogs.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/tax/test_country_catalogs.py` |  |
| `backend/tests/test_location.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/test_location.py` | prefijo `/api`, tests de búsqueda por país, aserciones corregidas |
| `backend/tests/test_tax.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/test_tax.py` | prefijo `/api`, aserciones corregidas |

---

## 30. Buckets diarios de reportes en la fecha local del usuario, no en UTC

**Problema.** Los reportes financieros agrupaban por día con `func.date(Payment.date_created)` sobre un timestamp naive-UTC. Un pago después de las 21:00 en Argentina ya es
el día siguiente en UTC, así que filtrar "un solo día" mostraba una fila fantasma del día posterior. Los límites del filtro (`start_date`/`end_date`) estaban bien; solo la
etiqueta del día estaba mal.

**Solución.** Las rutas de reportes diarios ahora reciben `utc_offset_minutes` (mismo `Query(0, ge=-840, le=840, description=UTC_OFFSET_HELP)` y misma convención que el
historial de dispositivos del cambio 22) y arman la fecha con `format_local`/`formatted_time` de `backend/app/api/device/history/query_utils.py` en vez de `func.date(...)`.
El frontend manda el offset del navegador. El valor por defecto (0) no rompe a quien no lo mande. **Este proyecto todavía no tiene `backend/app/api/reports/`** (recién lo
trae el cambio 4, sobre lecturas de sensores en vez de pagos): este cambio solo aplica **después** de portar el 4, sobre las mismas rutas de agregación diaria que traiga ese
reporte. Si el cambio 4 no incluye una agregación por día, este cambio no tiene dónde aplicarse.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/reports/repository.py` | modificado (tras el cambio 4) | `/home/martin/Code/DVEM-App/backend/app/api/reports/repository.py` | ⚠ agrupa por `Payment.date_created`: reescribir sobre lecturas de sensores |
| `backend/app/api/reports/router.py` | modificado (tras el cambio 4) | `/home/martin/Code/DVEM-App/backend/app/api/reports/router.py` | agrega `utc_offset_minutes: int = Query(0, ge=-840, le=840, description=UTC_OFFSET_HELP)` importado de `app.api.device.history.router` |
| `backend/app/api/reports/service.py` | modificado (tras el cambio 4) | `/home/martin/Code/DVEM-App/backend/app/api/reports/service.py` | propaga `utc_offset_minutes` a la capa de repositorio |
| `backend/tests/api/reports/test_daily_bucket_timezone.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/reports/test_daily_bucket_timezone.py` | ⚠ construye pagos de ejemplo: adaptar a lecturas de sensores |
| `frontend/src/api/reports.api.ts` | modificado (tras el cambio 4) | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.ts` | manda el offset del navegador |
| `frontend/src/api/reports.api.test.ts` | modificado (tras el cambio 4) | `/home/martin/Code/DVEM-App/frontend/src/api/reports.api.test.ts` |  |

## 31. Dispositivos ordenables por "Tipo"

**Problema.** El listado de dispositivos se podía ordenar por nombre, estado, fecha de fabricación, última conexión, presencia, establecimiento y propietario, pero no por
tipo de dispositivo.

**Solución.** Se agregó `"deviceTypeName"` al `Literal` de `sort_by` del backend (router y repositorio), reutilizando el `outerjoin` a `DeviceTypeCatalog` que ya existía
para la búsqueda cuando está disponible (para no duplicar el `JOIN`), y ordenando con `NULLS LAST` igual que el resto de las columnas que admiten dispositivos sin ese dato.
En el frontend, la columna "Tipo" de `DevicesTable` gana `id: DEVICE_SORT_BY.DEVICE_TYPE_NAME`, `accessorFn: (device) => device.type?.name` y `enableSorting: true`.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/app/api/device/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/repository.py` | agrega `"deviceTypeName"` al `Literal` de `sort_by` y el `elif` de ordenamiento |
| `backend/app/api/device/router.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/router.py` | agrega `"deviceTypeName"` al `Literal` del parámetro `sort_by` |
| `backend/tests/api/device/test_device_sorting.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_device_sorting.py` | caso `deviceTypeName` y test de que reutiliza el `JOIN` de la búsqueda |
| `frontend/src/app/types/device.types.ts` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/types/device.types.ts` | agrega `DEVICE_TYPE_NAME: "deviceTypeName"` a `DEVICE_SORT_BY` |
| `frontend/src/app/components/devices/DevicesTable.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.tsx` | columna "Tipo" ordenable en las dos vistas de la tabla (admin y usuario) |
| `frontend/src/app/components/devices/DevicesTable.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/devices/DevicesTable.test.tsx` |  |

## 32. Aviso de privacidad de login y registro enlazado a la landing

**Problema.** Las pantallas de login y registro mostraban un texto de aceptación de "términos y condiciones" que apuntaba a `href="#"` (un enlace muerto), sin política de
privacidad real.

**Solución.** El texto se reemplaza por "Al continuar, aceptás la política de privacidad." con el enlace a `PRIVACY_POLICY_URL`, una URL absoluta a `/privacidad` en la
landing. **Este proyecto ya tiene ambas piezas**: `frontend/src/config/publicUrls.ts` ya exporta `PRIVACY_POLICY_URL` (con `resolveLandingPageUrl`, equivalente a la
`landingPageUrl` de DVEM) y `landing/src/pages/privacidad.astro` ya existe. Lo único que falta es reemplazar el texto de `LoginPage.tsx` y `RegisterPage.tsx` por el aviso y
el enlace — no hay que tocar `publicUrls.ts` ni crear la página de la landing.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/auth/pages/login/LoginPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/login/LoginPage.tsx` | importar `PRIVACY_POLICY_URL` de `@/config/publicUrls` (ya existe en este proyecto) |
| `frontend/src/auth/pages/login/LoginPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/login/LoginPage.test.tsx` |  |
| `frontend/src/auth/pages/register/RegisterPage.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.tsx` | ídem |
| `frontend/src/auth/pages/register/RegisterPage.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/auth/pages/register/RegisterPage.test.tsx` |  |

## 33. Typecheck de producción limpio

**Problema.** `tsc --noEmit` sobre el `tsconfig.json` raíz no revisa nada útil (el raíz solo referencia los otros tsconfigs vía `references`); el typecheck real de producción
es el que corre `npm run build` (`tsc -b && vite build`). Al correr `tsc -b` de verdad en DVEM aparecieron errores genéricos, entre ellos uno en el `FormField` compartido de
shadcn: le faltaba un tercer parámetro de tipo (`TTransformedValues`) que `ControllerProps` de `react-hook-form` sí admite, y que aparece en cuanto algún formulario usa un
resolver que transforma el tipo de salida (por ejemplo Zod con `.transform()`).

**Solución.** `frontend/src/components/ui/form.tsx`: `FormField` gana el genérico `TTransformedValues = TFieldValues` y lo propaga a `ControllerProps<TFieldValues, TName,
TTransformedValues>`. **Este proyecto ya usa `tsc -b` en `npm run build`** (no hace falta cambiar `package.json`), así que alcanza con: aplicar el fix de `form.tsx` (genérico,
no depende de nada de DVEM) y correr `cd frontend && npm run build` para ver si aparece algún otro error de tipos propio de este proyecto (los demás archivos que tocó este
commit en DVEM son específicos de HMPACKING/Expendedora y de `MoneyInput` y no aplican acá).

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/components/ui/form.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/components/ui/form.tsx` | agrega el genérico `TTransformedValues` a `FormField` |

## 34. Tipo de dispositivo legado "Other" desactivado vía migración

**Problema.** "Other" era un tipo de dispositivo catch-all heredado que no representa ningún producto real, pero aparecía en el selector de tipos porque el repositorio lo
recreaba y reactivaba solo cada vez que se resolvía su id (`ensure_legacy_other_exists`), igual que hace con el tipo por defecto.

**Solución.** Una migración de datos (pura, sin cambio de esquema) desactiva la fila fija de "Other" (`is_active = False`); el `downgrade` la reactiva. Se elimina
`ensure_legacy_other_exists`, `get_legacy_other` y la rama que los usaba en `resolve` del repositorio: como cualquier otro tipo inactivo, ya no se recrea ni se reactiva solo,
queda fuera del selector y no se puede asignar a dispositivos nuevos; los dispositivos existentes de ese tipo lo siguen resolviendo normalmente (se conserva la fila, no se
borra, por la FK). **Este proyecto tiene exactamente el mismo patrón** (`LEGACY_OTHER_DEVICE_TYPE_ID/CODE/NAME` en `device_type/constants.py` y
`ensure_legacy_other_exists`/`get_legacy_other` en `device_type/repository.py`), así que aplica sin adaptación más allá de encadenar la migración a la cabeza de este
proyecto.

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `backend/alembic/versions/z2a3b4c5d6e7_deactivate_legacy_other_device_type.py` | nuevo | `/home/martin/Code/DVEM-App/backend/alembic/versions/z2a3b4c5d6e7_deactivate_legacy_other_device_type.py` | re-encadenar `down_revision` a la cabeza de este proyecto |
| `backend/app/api/device/device_type/repository.py` | modificado | `/home/martin/Code/DVEM-App/backend/app/api/device/device_type/repository.py` | elimina `get_legacy_other`, `ensure_legacy_other_exists` y la rama de `resolve` que los usaba |
| `backend/tests/alembic/test_deactivate_legacy_other_revision.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/alembic/test_deactivate_legacy_other_revision.py` |  |
| `backend/tests/api/device/test_device_type_router.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_device_type_router.py` |  |
| `backend/tests/api/device/test_legacy_other_deactivation.py` | nuevo | `/home/martin/Code/DVEM-App/backend/tests/api/device/test_legacy_other_deactivation.py` |  |
| `backend/tests/api/test_device.py` | modificado | `/home/martin/Code/DVEM-App/backend/tests/api/test_device.py` |  |

## 35. Mapa del formulario de establecimiento sigue la altura del formulario

**Problema.** En el formulario de Establecimiento, el mapa de la columna derecha tenía un `xl:min-h-[44rem]` fijo que obligaba a la tarjeta a ser más alta que el contenido
real del formulario, sin entrar completa en una pantalla Full HD.

**Solución.** Se baja el mínimo de `xl:min-h-[44rem]` a `xl:min-h-[24rem]` (en DVEM, junto con compactar la sección de Mercado Pago, que no se porta) y se agrega
`data-testid="environment-map-container"` para poder testearlo. **Este proyecto tiene el mismo `xl:min-h-[44rem]` en `EnvironmentForm.tsx`** (línea 761 al momento de
escribir esto), en el contenedor del mapa: aplica el mismo ajuste de altura, sin la parte de compactar campos de Mercado Pago (no existen en este proyecto).

| Archivo (en este proyecto) | Estado | Leer en DVEM-App (origen) | Nota |
| --- | --- | --- | --- |
| `frontend/src/app/components/environments/EnvironmentForm.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentForm.tsx` | ⚠ el commit de origen también compacta el bloque de ubicación de Mercado Pago: portar solo el cambio de altura del mapa (`xl:min-h-[44rem]` → `xl:min-h-[24rem]`) y el `data-testid` |
| `frontend/src/app/components/environments/EnvironmentForm.test.tsx` | modificado | `/home/martin/Code/DVEM-App/frontend/src/app/components/environments/EnvironmentForm.test.tsx` | solo el test que verifica `min-h-[44rem]` ausente en `environment-map-container` |

---

## Lo que NO se porta (cobros y Mercado Pago)

- Las tablas de administración de Mercado Pago (vendedores, sucursales, cajas), aunque también adoptaron el estándar del cambio 17, y los mapas de etiquetas de pagos (métodos, estados y detalles de rechazo) de los cambios 21 y 22.
- **`MoneyInput`** (`frontend/src/components/custom/MoneyInput.tsx` y `moneyInputCore.ts`): input de dinero con agrupado por locale, decimales por moneda y el aviso de límite de decimales. Es una pieza de UI genérica en sí misma, pero **todo lo que la usa y todo lo que resuelve** (moneda, `Intl.NumberFormat` con `currency`, precio de dispositivo) es de cobros; no hay ningún campo de importe en este proyecto que la necesite. No se porta.
- Todo lo de **HMPACKING/Expendedora** (máquina vending): niveles, motores, capacidad, imágenes de producto y almacenamiento de objetos (S3/SeaweedFS), limpieza de medios. Se excluyó por completo de este documento porque este proyecto no tiene ese tipo de dispositivo; se listan los commits de referencia en DVEM-App por si hace falta ubicarlos: `25b8727b`, `00112287`, `01409469`, `26c2996f`, `bb23d87c`, `f8ae8c4a`, `d00f9d8a`, `59a8c9e9`, `636c0d46`, `df1717cf`, `5f90bb40`, `622c8470`, `64d98b33`, `acbc2282`, `f71ee76f`, `290eda1a`, `74df7422`, `c997ac40`, y sus commits de documentación (`docs(hmpacking): ...`, `docs(env): ...`).

No copiar ni buscar equivalentes de estos cambios de DVEM-App. Se listan solo para que se reconozcan si aparecen en archivos mixtos:

- Catálogos de ubicaciones de Mercado Pago (AR, PE, BR, MX, CL, CO, UY), `backend/ops/sync_mp_location_catalog.py` y su documentación.
- Moneda por país, formato de dinero, filtros y reportes por moneda, `payment.currency_id`.
- Regla de importe mayor a cero, importe obligatorio u opcional al crear/asociar un dispositivo, campo de precio.
- Reasignación de la caja (POS) de Mercado Pago al cambiar de establecimiento, aprovisionamiento de tiendas y cajas, generación de QR y órdenes.
- El runtime de pagos (`payments-runtime`, webhooks, reembolsos), la política de invitados sobre `paymentfee` (`t5u6v7w8x9y0`) y la atribución de pagos al establecimiento
  que los originó.
- El ajuste del manejador MQTT `init_point` para dispositivos sin dueño.
- Comisiones (DVEM y de invitados) en dispositivos, establecimientos y en el traslado de dispositivos.
- El campo "Comisión Invitados" de Ajustes Generales (cambio 27): se sacó de la pantalla porque en DVEM esa comisión siempre la define el propietario del establecimiento, no el administrador; el resto de los campos de esa misma pantalla (Comisión DVEM, costo mínimo, expiración del QR) también son de cobros y no se portan — solo el patrón de layout.
