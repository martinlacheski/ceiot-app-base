# FastAPI Backend Base

Base sólida y modular para proyectos backend con FastAPI, SQLModel y Alembic.

## Características

- **Modularidad**: Estructura organizada por dominios (`auth`, `person`, etc.).
- **Autenticación**: JWT con OAuth2, hashing de contraseñas y gestión de permisos.
- **Base de Datos**: SQLModel (SQLAlchemy + Pydantic) con migraciones automáticas via Alembic.
- **Paginación**: Utilidad reutilizable para respuestas paginadas.
- **Soft Delete**: Implementación de eliminado lógico (campo `is_active`).
- **Testing**: Suite de pruebas completa con `pytest` y base de datos en memoria.
- **Configuración**: Gestión de variables de entorno con `pydantic-settings`.

## Requisitos

- Python 3.10+
- Virtualenv (recomendado)

## Instalación

1.  **Clonar el repositorio**:

    ```bash
    git clone <url-del-repo>
    cd FastAPI-Backend-Base
    ```

2.  **Crear entorno virtual**:

    ```bash
    python -m venv .venv
    source .venv/bin/activate  # Linux/Mac
    # .venv\Scripts\activate   # Windows
    ```

3.  **Instalar dependencias**:

    ```bash
    pip install -r requirements.txt
    ```

4.  **Configurar variables de entorno**:
    Copia el archivo `.env.example` a `.env` y ajusta los valores:
    ```bash
    cp .env.example .env
    ```

## Administrador inicial

En una instalación nueva, configurá `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` mediante el canal de entorno que ya administra el operador. No pases credenciales como argumentos de comandos ni las recuperes desde logs. La contraseña inicial debe tener entre 12 y 1024 caracteres y se conserva exactamente como fue provista.

El arranque crea el administrador sólo cuando no existe ningún administrador. Un administrador existente, incluso si está deshabilitado, hace que el proceso omita las credenciales sin validarlas ni modificar cuentas, permisos o contraseñas. Si el nombre de usuario o el correo ya pertenecen a otra cuenta, el arranque falla en lugar de promoverla o sobrescribirla. La cuenta nueva conserva el cambio obligatorio de contraseña en el primer ingreso.

La creación está serializada con un bloqueo transaccional de PostgreSQL y requiere ese motor. Los errores de configuración o base de datos se informan sin incluir valores de credenciales.

## Base de Datos

The database schema is managed exclusively by Alembic. Run `alembic upgrade head`
before starting the backend against an empty database.

No vuelvas automáticamente a una imagen anterior del backend: esas imágenes no tienen estos controles de arranque. Ante una falla, detené la publicación y aplicá una corrección hacia adelante, o usá únicamente un fallback protegido y verificado por separado. Un rollback sólo del frontend puede seguir siendo válido.

1.  **Generar migraciones** (si haces cambios en modelos):

    ```bash
    alembic revision --autogenerate -m "descripcion"
    ```

2.  **Aplicar migraciones**:
    ```bash
    alembic upgrade head
    ```

## Ejecución

### Desarrollo

```bash
fastapi dev app/main.py
```

El servidor estará disponible en `http://127.0.0.1:8000`.
Documentación interactiva en `http://127.0.0.1:8000/docs`.

### Producción

```bash
fastapi run app/main.py
```

## Configuración de correo

`MAIL_TRANSPORT` selecciona explícitamente `smtp` (predeterminado) o `mailpit`. En modo SMTP se usan `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` y `MAIL_FROM`; sus valores seguros predeterminados son `MAIL_STARTTLS=true`, `MAIL_SSL_TLS=false`, `MAIL_USE_CREDENTIALS=true` y `MAIL_VALIDATE_CERTS=true`. `MAIL_STARTTLS` y `MAIL_SSL_TLS` no pueden estar activos al mismo tiempo.

En modo Mailpit el backend ignora host, puerto, credenciales y banderas SMTP externas y usa únicamente `mailpit:1025`, sin TLS ni autenticación. Esto permite captura local sin credenciales SMTP reales, pero no entrega correos. No existe fallback a un proveedor externo si Mailpit falla.

| Variable | Uso |
| --- | --- |
| `MAIL_TRANSPORT` | `smtp` o `mailpit`; predeterminado `smtp`. |
| `MAIL_STARTTLS` | Habilita STARTTLS en SMTP; predeterminado `true`. |
| `MAIL_SSL_TLS` | Habilita TLS implícito en SMTP; predeterminado `false`. |
| `MAIL_USE_CREDENTIALS` | Autenticación SMTP; predeterminado `true`. |
| `MAIL_VALIDATE_CERTS` | Validación de certificados SMTP; predeterminado `true`. |
| `MAIL_FROM_NAME` | Marca visible y asunto; predeterminado `Monitoreo Ambiental IoT`. Si conservás un valor legado en el entorno, actualizalo manualmente. |
| `CONTACT_RECIPIENT` | Destino opcional del formulario; si falta, usa `MAIL_FROM`. |
| `MAILPIT_UI_PORT` | Puerto local de la UI al activar el perfil `local-mail`; predeterminado `8025`. |

El remitente SMTP siempre es `MAIL_FROM`; en contactos, el correo del visitante se configura sólo como `Reply-To`. Guardá los valores del operador manualmente en `backend/.env`. Para la landing local, agregá `http://localhost:14321` a `BACKEND_CORS_ORIGINS` y ajustá `BACKEND_TRUSTED_HOSTS` a los hosts realmente usados. El rate limit del contacto es local al proceso y `X-Forwarded-For` requiere una política de proxy confiable antes de producción.

## RAG sobre documentos (administración)

Los administradores suben PDF, TXT, MD y DOCX en `/admin/documents`. Al subirlos (o con
**Reindexar**) cada archivo se descarga de SeaweedFS, se parte en fragmentos de ~1200 caracteres
con solape de 150 (con página o sección de origen), se calculan los embeddings BAAI/bge-m3
(1024 dimensiones) y se guardan en PostgreSQL con pgvector (`document_chunk`, índice HNSW).

| Variable | Descripción |
| --- | --- |
| `EMBEDDING_PROVIDER` | `openrouter` (predeterminado, usa `OPENROUTER_API_KEY`) o `local`. |
| `EMBEDDING_LOCAL_URL` | URL del servidor TEI; compose ya define `http://embeddings:80` (perfil `embeddings-local`, ver `embeddings/README.md`). |
| `MODELO_EMBEDDING` | Modelo; predeterminado `BAAI/bge-m3` (OpenRouter: `baai/bge-m3`). |
| `RAG_MAX_COSINE_DISTANCE` | Corte de distancia coseno; predeterminado `0.55`. Es específico del modelo: recalibrarlo si se cambia. |
| `RAG_TOP_K` | Fragmentos por consulta; predeterminado `4`, máximo `8`. |

Cada fragmento guarda el proveedor y el modelo que lo generó; la recuperación sólo usa los del
proveedor y modelo **actuales**, así que cambiar de proveedor deja los documentos como
"Requiere reindexar" hasta que un administrador use **Reindexar** (`POST /api/documents/reindex`;
`?all=true` rehace todos). Sin claves o sin servidor local la ingesta y las consultas responden
503 y el resto de la aplicación sigue funcionando.

Consulta: `POST /api/assistant/rag` `{question, documentId?}` para cualquier usuario autenticado
(los documentos activos son contenido corporativo cargado por administradores). Sin evidencia por
debajo del corte responde "No encontré información en los documentos." sin llamar al modelo. La
tabla `document_chunk` es sólo para administradores (RLS); la recuperación pasa por la función
`rag_search` (SECURITY DEFINER), que únicamente devuelve fragmentos de documentos activos y
listos del proveedor/modelo vigente.

## Testing

Ejecutar la suite de pruebas:

```bash
pytest
```

## Estructura del Proyecto

```
app/
├── api/            # Módulos de la API (auth, person, etc.)
├── core/           # Configuración, DB, seguridad, dependencias
├── seeds/          # Scripts para poblar la BD
├── services/       # Lógica de negocio reutilizable (ej. paginación)
└── main.py         # Punto de entrada
tests/              # Tests unitarios e integración
alembic/            # Migraciones de BD
```
