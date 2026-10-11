"""Permissions for environmental sensor APIs."""


class SensorCatalogPermissions:
    READ = "sensor_catalog:read"
    WRITE = "sensor_catalog:write"
    DEVICE_READ = "device_sensor:read"
    DEVICE_WRITE = "device_sensor:write"
    TELEMETRY_READ = "telemetry:read"


SENSOR_CATALOG_PERMISSIONS = {
    "label": "Sensores ambientales",
    "items": [
        {"value": SensorCatalogPermissions.READ, "label": "Ver catálogo de sensores"},
        {"value": SensorCatalogPermissions.WRITE, "label": "Gestionar catálogo de sensores"},
        {"value": SensorCatalogPermissions.DEVICE_READ, "label": "Ver sensores de dispositivos"},
        {"value": SensorCatalogPermissions.DEVICE_WRITE, "label": "Gestionar sensores de dispositivos"},
        {"value": SensorCatalogPermissions.TELEMETRY_READ, "label": "Ver telemetría"},
    ],
}
