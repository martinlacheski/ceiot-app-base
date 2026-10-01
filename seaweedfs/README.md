# SeaweedFS (almacenamiento de objetos)

Guarda los archivos del módulo **Documentos** (administración), que más adelante
será el corpus del RAG. Corre como un único proceso (`weed server`: master,
volume, filer y gateway S3) con la imagen oficial `chrislusf/seaweedfs`, con la
versión fijada en `docker-compose.yml`.

- **Solo red interna**: no publica puertos en el host. El navegador nunca habla
  con SeaweedFS; el backend sube y descarga los archivos a través de su API
  autenticada (`/api/documents`).
- **S3 interno**: `http://seaweedfs:8333`, bucket `ceiot-documents` (el backend
  lo crea la primera vez que se usa).
- **Datos**: `seaweedfs/data/` (git-ignorado, bind mount a `/data`).

## Credenciales

Variables en `seaweedfs/.env` (git-ignorado; plantilla en `.env.example`), leídas
por `seaweedfs`, `backend` y `mqtt-runtime`:

| Variable | Qué es | Cómo generarla |
|---|---|---|
| `S3_ACCESS_KEY` | access key del único usuario S3 | `openssl rand -hex 12` |
| `S3_SECRET_KEY` | secret key | `openssl rand -hex 32` |

No usar comillas, barras invertidas ni espacios en los valores.

El archivo es **opcional** para que el stack arranque sin él:

- Sin las claves, `seaweedfs` no sirve nada (queda *unhealthy* y lo explica en
  su log) y el módulo Documentos responde `503 Almacenamiento no configurado`.
  El resto de la aplicación funciona igual.
- El script `docker-entrypoint-wrapper.sh` genera la configuración de identidades
  S3 dentro del contenedor (`/etc/seaweedfs/s3.json`) a partir de esas variables;
  el secreto nunca se escribe en el host ni en archivos versionados.

Después de crear o cambiar `seaweedfs/.env`:

```bash
MAIL_TRANSPORT=mailpit docker compose up -d seaweedfs backend mqtt-runtime
```

(Cambiar las claves no migra nada: los objetos ya guardados siguen en
`seaweedfs/data/`; solo cambia con qué credenciales se accede.)

## Respaldo

Los metadatos (título, hash, estado de ingesta) están en PostgreSQL (tabla
`document`) y los bytes en `seaweedfs/data/`. Un respaldo consistente necesita
ambos:

1. Detener escrituras: `docker compose stop seaweedfs`.
2. Copiar el directorio: `tar czf seaweedfs-$(date +%F).tgz seaweedfs/data`.
3. Respaldar la base de datos como siempre.
4. `docker compose start seaweedfs`.

Para restaurar, detener `seaweedfs`, reemplazar `seaweedfs/data/` y arrancar de
nuevo. Si un objeto falta, la descarga del documento responde 404 y se puede
eliminar y volver a subir.
