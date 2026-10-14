# Frontend (aplicación web)

Aplicación web de la plataforma CEIoT: dashboard de dispositivos y telemetría,
mapas y administración. Es una SPA en React 19 + TypeScript, construida con
Vite y estilada con Tailwind CSS 4; usa React Router, TanStack Query, Zustand
y axios. Los tests corren con Vitest (jsdom).

La puesta en marcha completa del stack (variables, certificados, primer
inicio de sesión) está en [`../docs/puesta-en-marcha.md`](../docs/puesta-en-marcha.md).

## En Docker (uso normal)

El frontend se levanta con el resto del stack desde la raíz del repositorio:

```sh
scripts/levantar.sh            # sin reconstruir imágenes
scripts/levantar.sh --build    # reconstruye las imágenes
```

La imagen compila la app con `vite build` y la sirve con Nginx. Queda
publicada en <http://localhost:5173> (`FRONTEND_PORT` del `.env` de la raíz,
solo en `127.0.0.1`).

Las variables `VITE_*` se fijan durante la compilación de la imagen. Compose
las deriva del `.env` de la raíz y un valor en `frontend/.env` reemplaza a cada
una:

| Variable | Origen por defecto |
| --- | --- |
| `VITE_API_URL` | `PUBLIC_SCHEME://PUBLIC_HOST:BACKEND_PORT/api` |
| `VITE_APP_LOGIN_URL` | `PUBLIC_SCHEME://PUBLIC_HOST:FRONTEND_PORT/auth/login` |
| `VITE_LANDING_URL` | `PUBLIC_SCHEME://PUBLIC_HOST:LANDING_PORT` |
| `VITE_GCP_API_KEY` | `GOOGLE_MAPS_API_KEY` |
| `VITE_TOKEN_REFRESH` | obligatoria; intervalo de refresco del token, en segundos |
| `VITE_SESSION_TIMEOUT` | obligatoria; minutos de inactividad antes de cerrar la sesión |

Después de cambiar cualquiera de ellas, reconstruí la imagen con
`scripts/levantar.sh --build`: reiniciar el contenedor no alcanza.

## Fuera de Docker (desarrollo)

```sh
cd frontend
npm ci
npm run dev
```

`npm run dev` no lee `frontend/.env`: Vite toma las variables del `.env` de la
raíz del repositorio (`envDir: ".."` en `vite.config.ts`). Agregá ahí las
`VITE_*` que necesites, por ejemplo `VITE_API_URL=http://localhost:8000/api`;
tené en cuenta que esos valores también reemplazan a los que arma Docker.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | servidor de desarrollo de Vite |
| `npm run build` | chequeo de tipos (`tsc -b`) y build de producción en `dist/` |
| `npm run preview` | sirve localmente el build de `dist/` |
| `npm run lint` | ESLint sobre todo el proyecto |
| `npm test` | Vitest en modo observación; `npx vitest run` ejecuta una sola pasada |
