"""The curated text-to-SQL surface: ai_read views, their columns and meaning.

The migration (0012) creates the views; this module is the single in-code copy
of what the model may reference. The SQL guard validates against it, the schema
prompt describes it, and a PostgreSQL test pins it to the real catalog so the
two can never drift silently.
"""

SCHEMA = "ai_read"

# view -> ordered column -> (type, description). Order mirrors the view DDL.
VIEWS: dict[str, dict[str, tuple[str, str]]] = {
    "telemetry": {
        "measured_at": ("timestamptz", "instante de la medición"),
        "device_id": ("uuid", "id del equipo"),
        "device_serial": ("text", "serie del equipo"),
        "device_name": ("text", "nombre del equipo"),
        "environment_id": ("uuid", "id del ambiente"),
        "environment_name": ("text", "nombre del ambiente"),
        "sensor_key": ("text", "clave del sensor dentro del equipo (p. ej. dht22_1)"),
        "sensor_model_code": ("text", "código del modelo de sensor (p. ej. dht22)"),
        "sensor_model": ("text", "nombre del modelo de sensor (p. ej. DHT22)"),
        "variable": ("text", "código de la variable medida (p. ej. temperature)"),
        "variable_name": ("text", "nombre de la variable en español"),
        "unit": ("text", "unidad de la variable (p. ej. °C)"),
        "value": ("numeric", "valor medido, en la unidad indicada"),
    },
    "devices": {
        "id": ("uuid", "id del equipo"),
        "serial": ("text", "serie del equipo"),
        "name": ("text", "nombre del equipo"),
        "device_type": ("text", "tipo de equipo"),
        "environment_id": ("uuid", "id del ambiente donde está instalado"),
        "environment_name": ("text", "nombre del ambiente"),
        "status": ("text", "estado: NEW, PAIRED, ACTIVE, MAINTENANCE o UNPAIRED"),
        "enabled": ("boolean", "habilitado para operar"),
        "is_active": ("boolean", "registro activo"),
        "online": ("boolean", "conectado al broker ahora"),
        "last_connection": ("timestamp", "última conexión conocida"),
    },
    "environments": {
        "id": ("uuid", "id del ambiente"),
        "name": ("text", "nombre del ambiente"),
        "environment_type": ("text", "tipo de ambiente"),
        "city": ("text", "ciudad"),
        "state": ("text", "provincia o estado"),
        "country": ("text", "país"),
        "is_active": ("boolean", "registro activo"),
    },
    "sensors": {
        "device_id": ("uuid", "id del equipo"),
        "device_serial": ("text", "serie del equipo"),
        "device_name": ("text", "nombre del equipo"),
        "sensor_key": ("text", "clave del sensor dentro del equipo"),
        "sensor_model_code": ("text", "código del modelo de sensor"),
        "sensor_model": ("text", "nombre del modelo de sensor"),
        "manufacturer": ("text", "fabricante del modelo"),
        "is_active": ("boolean", "sensor instalado y activo"),
        "installed_at": ("timestamptz", "fecha de instalación"),
    },
    "variables": {
        "code": ("text", "código de la variable (p. ej. temperature)"),
        "name": ("text", "nombre en español"),
        "unit": ("text", "unidad (p. ej. °C)"),
    },
}

ALLOWED_COLUMNS: dict[str, frozenset[str]] = {view: frozenset(cols) for view, cols in VIEWS.items()}
