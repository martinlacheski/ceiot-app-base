# Instructivo para Semillas (Seeds)

Este proyecto cuenta con scripts de semillas para poblar la base de datos con información de prueba.

## 1. Semilla de Usuarios (`seed_users.py`)

Genera 60 usuarios aleatorios con nombres y apellidos variados para probar la paginación y el ordenamiento en el panel de administración.

### Requisitos previos

- Tener instalado Python 3.10+ en el host.
- Tener instaladas las dependencias necesarias (`psycopg`, `python-dotenv`).
- Tener el archivo `.env` configurado en la raíz del proyecto.

### Ejecución desde el Host (Local)

1. Instala las dependencias si no las tienes:
   ```bash
   pip install psycopg python-dotenv
   ```
2. Ejecuta el script desde la raíz del proyecto:
   ```bash
   python seeds/seed_users.py
   ```

### Ejecución desde Docker (Recomendado)

Si no deseas instalar dependencias localmente, puedes ejecutar el script dentro del contenedor de `backend`:

1. Asegúrate de que los contenedores estén corriendo:
   ```bash
   docker compose up -d
   ```
2. Ejecuta el script usando `docker exec`:
   ```bash
   docker exec -it iot-app-base-backend python /app/seeds/seed_users.py
   ```
   _Nota: El contenedor `backend` tiene montada la carpeta `backend` en `/app`. Como la carpeta `seeds` está en la raíz, se accede subiendo un nivel._

## Notas Adicionales

- Todos los usuarios creados tienen la clave: `123456Ab` (basado en el hash proporcionado).
- Los usuarios se crean como **Verificados** y **Activos**.
- El script evita duplicados basándose en el correo electrónico.
