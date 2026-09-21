# Landing de monitoreo ambiental IoT

Sitio estático informativo en español, inglés y portugués de Brasil. Presenta una base conceptual para temperatura ambiente, humedad relativa y presión atmosférica; no representa telemetría en vivo ni una instalación operativa.

## Configuración pública

| Variable | Uso |
| --- | --- |
| `PUBLIC_APP_LOGIN_URL` | URL del panel. Si falta, la llamada a la acción se muestra deshabilitada y no se inventa un destino. |
| `PUBLIC_API_BASE_URL` | Prefijo completo de la API, por ejemplo `http://localhost:18000/api`. El formulario agrega `/public/contact`; no agregues credenciales, query ni fragmento. Si falta o es inválido, el formulario queda deshabilitado. |
| `PUBLIC_WHATSAPP_NUMBER` | Número internacional opcional para el botón flotante de contacto. Usá solamente entre 8 y 15 dígitos, sin `+`, espacios ni separadores, y sin cero inicial. Si falta o es inválido, el botón no se muestra. |
| `PUBLIC_SITE_URL` | Origen público opcional, sin barra final. Habilita canonical, hreflang, sitemap y metadatos absolutos. |

`PUBLIC_API_BASE_URL` y `PUBLIC_WHATSAPP_NUMBER` se incorporan durante el build estático. Después de cambiarlos, reconstruí la imagen de `landing`; reiniciar un contenedor construido anteriormente no actualiza el formulario ni el botón.

El backend debe permitir por CORS el origen exacto desde el que se sirve la landing. El formulario muestra estados genéricos: una respuesta aceptada confirma recepción por la API, no garantiza entrega de correo. En desarrollo, Mailpit captura mensajes localmente cuando el backend usa explícitamente ese transporte; no entrega a destinatarios reales ni requiere cambios de Mailpit en esta landing.

Para desarrollo: `npm ci`, `npm test` y `npm run build` dentro de `landing/`.
