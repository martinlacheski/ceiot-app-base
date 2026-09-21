# Configurar el acceso con Google

Esta guía permite habilitar el botón **Google** con credenciales OAuth propias. La aplicación nunca solicita ni almacena la contraseña de Google: el inicio de sesión ocurre en Google y el backend recibe solamente el resultado autorizado del flujo OAuth.

## Camino rápido

### 1. Crear la configuración en Google Cloud

1. Iniciá sesión con una cuenta de Google y creá un proyecto nuevo en [Google Cloud Console](https://console.cloud.google.com/). Usá credenciales nuevas del proyecto; no reutilices credenciales antiguas o expuestas.
2. Abrí **Google Auth Platform** y completá **Branding** (o **Get started**): información de la aplicación, audiencia y datos de contacto.
3. En **Audience**, elegí la audiencia adecuada. Si la aplicación es externa y todavía está en prueba, agregá explícitamente los usuarios permitidos en **Test users**.
4. En **Data Access**, solicitá únicamente los permisos mínimos de identidad: `openid`, `email` y `profile`.
5. Entrá en **Clients** → **Create client** y elegí **Web application**.
6. Agregá como URI de redirección autorizada la URL pública exacta del callback del backend:

   ```text
   http://localhost:18000/api/auth/google/callback
   ```

   Esa URL es el ejemplo local predeterminado. No uses la ruta del frontend `/auth/social-callback` como callback autorizado en Google.

> Google compara esquema, host, puerto, mayúsculas/minúsculas y barra final. La URI configurada debe coincidir exactamente con la que envía el backend. En producción usá HTTPS; Google admite HTTP solamente para localhost.

### 2. Configurar el backend

El operador —no el agente ni el navegador— debe guardar estos valores reales en `backend/.env`:

```dotenv
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=<client-id-del-cliente-web>
GOOGLE_CLIENT_SECRET=<client-secret-del-cliente-web>
BACKEND_PUBLIC_BASE_URL=http://localhost:18000
VITE_FRONTEND_URL=http://localhost:15173
```

Las dos URLs son ejemplos únicamente para el entorno local con esos puertos. En producción —o si usás puertos distintos— configurá los orígenes públicos reales que controla el operador.

El `GOOGLE_CLIENT_SECRET` pertenece únicamente al backend. Nunca lo pongas en variables `VITE_*`, `PUBLIC_*`, código del navegador, documentación, historial ni archivos versionados. Tampoco ingreses una contraseña de Google en la aplicación.

La disponibilidad pública informa presencia de configuración, no una validación contra Google. Google queda habilitado únicamente si `GOOGLE_OAUTH_ENABLED` es `true` y ambos valores, sin espacios exteriores, son no vacíos. Credenciales antiguas sin el opt-in explícito no habilitan el flujo.

### 3. Recrear el contenedor del backend

Cambiar variables de Compose requiere **recrear** el contenedor; un reinicio simple no vuelve a cargar el entorno. Para conservar Mailpit en el entorno local y afectar solamente al backend:

```bash
MAIL_TRANSPORT=mailpit docker compose --profile local-mail -f docker-compose.yml up -d --no-deps --force-recreate backend
```

Seleccioná `MAIL_TRANSPORT=smtp` solamente de forma deliberada para un despliegue de producción configurado. No hace falta reconstruir el frontend por cambios de OAuth: el login consulta la disponibilidad al backend en tiempo de ejecución.

### 4. Validar manualmente

Después de completar tu propia configuración:

1. Abrí la pantalla de ingreso y confirmá que el botón **Google** sigue visible.
2. Presionalo y completá el inicio de sesión en Google con un usuario autorizado.
3. Confirmá que Google vuelve al callback del backend. Después, `/auth/social-callback` actúa como retorno intermedio: verifica la sesión y navega al destino seguro solicitado o, si no existe, a `/app`.

No hay una prueba automática contra una cuenta real de Google. Los tests del proyecto usan dobles sintéticos y no validan credenciales, políticas ni disponibilidad del servicio de Google.

### Verificación automática sin red

Desde la raíz del repositorio, ejecutá únicamente el grupo OAuth mediante su entrada aislada:

```bash
docker compose -f docker-compose.yml run --rm --no-deps -T -e MAIL_TRANSPORT=mailpit -v "$PWD/backend:/app:ro" --entrypoint python backend tests/oauth_offline_runner.py
```

El runner descarta la configuración heredada, evita la lectura de archivos dotenv, instala una denegación de DNS y sockets de red, y reemplaza los proveedores sociales antes de que pytest importe la aplicación. Solo admite `tests/test_google_oauth.py` o selecciones de nodos dentro de ese archivo. No valida credenciales reales, la configuración de Google Cloud, un flujo de navegador ni la disponibilidad de proveedores externos.

## Cómo se construyen las URLs públicas

### Callback del backend

1. Si `BACKEND_PUBLIC_BASE_URL` tiene un valor no vacío, se usa con precedencia y solamente se quita la barra final.
2. En caso contrario se usa `BACKEND_HOST_URL`.
3. `BACKEND_PORT` se agrega por separado solo para `localhost`, `127.0.0.1` o `::1`, cuando el host no trae puerto explícito.
4. No se agrega `80` a HTTP ni `443` a HTTPS.
5. Un host de producción no hereda el puerto interno del contenedor.

El resultado recibe `/api/auth/google/callback`. En producción, verificá la URL HTTPS resultante y copiala exactamente en el cliente OAuth de Google, incluida cualquier barra final relevante.

### Retorno al frontend

`VITE_FRONTEND_URL` sigue la misma política de puerto local con `VITE_FRONTEND_PORT`. El éxito vuelve primero a `/auth/social-callback`, que completa la verificación de sesión y navega al destino final seguro o a `/app`; el error vuelve a `/auth/login?error=social_auth_failed`. Estas rutas del frontend no reemplazan el callback autorizado del backend.

## Qué verá la persona usuaria

| Situación | Resultado |
| --- | --- |
| Opt-in explícito y ambos valores presentes | El frontend inicia el flujo OAuth de Google. |
| `GOOGLE_OAUTH_ENABLED=false` o falta una credencial | El botón permanece visible y muestra instrucciones de configuración. |
| Respuesta inválida, error HTTP o problema de red | El diálogo informa que no se pudo verificar la disponibilidad; no afirma que falten credenciales. |

Esta entrega cambia el botón de Google de la pantalla de ingreso. La experiencia del botón de registro queda fuera de alcance, aunque el backend protege por igual el login y el callback de Google.

## Solución de problemas

### Google aparece deshabilitado

- Confirmá que `GOOGLE_OAUTH_ENABLED=true` y que ambos valores reales están presentes y no vacíos.
- Recreá solamente el contenedor del backend; un reinicio no recarga variables de Compose.
- Recordá que tener valores heredados con el indicador en `false` mantiene Google deshabilitado.

### No se puede verificar la disponibilidad

- Comprobá que el frontend pueda acceder a `GET /api/auth/providers`.
- Revisá conectividad y configuración CORS entre los orígenes públicos del frontend y backend.
- Una falla de red no demuestra que las credenciales estén ausentes.

### `redirect_uri_mismatch`

- Compará la URI mostrada por Google con el callback público exacto del backend.
- Verificá esquema, host, puerto, mayúsculas/minúsculas y barra final.
- No registres `/auth/social-callback` como callback de Google.

### `invalid_client`

- Confirmá que el ID y el secreto pertenezcan al mismo cliente **Web application** del proyecto actual.
- Creá credenciales nuevas si las anteriores fueron heredadas, revocadas o expuestas.
- No uses credenciales de cuenta de servicio ni un secreto de cliente JavaScript.

### Google rechaza al usuario

- Si la audiencia externa está en prueba, agregá la cuenta en **Audience** → **Test users**.
- Revisá la política de publicación y los permisos solicitados. Para este flujo alcanzan los permisos mínimos de identidad; no hace falta habilitar Google+, Drive ni Calendar.

### El código está disponible pero Google no

El endpoint de disponibilidad confirma solo que la configuración local está presente. Google todavía puede rechazar el cliente, aplicar políticas de usuarios de prueba o estar temporalmente inaccesible. Diferenciá un problema del código o la red local de la disponibilidad y las políticas externas de Google.

## Referencias oficiales

- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent)
