"""Permissions for environmental sensor APIs."""


class SensorCatalogPermissions:
    READ = "sensor_catalog:read"
    DEVICE_READ = "device_sensor:read"
    DEVICE_WRITE = "device_sensor:write"
    TELEMETRY_READ = "telemetry:read"


SENSOR_CATALOG_PERMISSIONS = {
    "label": "Environmental sensors",
    "items": [
        {"value": SensorCatalogPermissions.READ, "label": "View sensor catalog"},
        {"value": SensorCatalogPermissions.DEVICE_READ, "label": "View device sensors"},
        {"value": SensorCatalogPermissions.DEVICE_WRITE, "label": "Manage device sensors"},
        {"value": SensorCatalogPermissions.TELEMETRY_READ, "label": "View telemetry"},
    ],
}
