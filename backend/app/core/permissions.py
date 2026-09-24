from typing import List, Dict, Any

from app.api.auth.permissions import USERS_PERMISSIONS
from app.api.location.permissions import LOCATIONS_PERMISSIONS
from app.api.tax.permissions import DOCUMENT_TYPES_PERMISSIONS
from app.api.environment.permissions import ENVIRONMENTS_PERMISSIONS, INVITATION_PERMISSIONS
from app.api.access.permissions import ACCESS_PERMISSIONS
from app.api.device.permissions import DEVICES_PERMISSIONS
from app.api.sensor.permissions import SENSOR_PERMISSIONS
from app.api.sensor_catalog.permissions import SENSOR_CATALOG_PERMISSIONS

# Definición centralizada de permisos agregando los módulos
PERMISSIONS_TREE = {
    "USERS": USERS_PERMISSIONS,
    "LOCATIONS": LOCATIONS_PERMISSIONS,
    "DOCUMENT_TYPES": DOCUMENT_TYPES_PERMISSIONS,
    "ENVIRONMENTS": ENVIRONMENTS_PERMISSIONS,
    "INVITATIONS": INVITATION_PERMISSIONS,
    "ACCESS": ACCESS_PERMISSIONS,
    "DEVICES": DEVICES_PERMISSIONS,
    "SENSORS": SENSOR_PERMISSIONS,
    "SENSOR_CATALOG": SENSOR_CATALOG_PERMISSIONS,
}

# Utilidad para obtener la lista plana de permisos (para validaciones y scripts)
def get_all_permissions_values() -> List[str]:
    permissions = []
    for group in PERMISSIONS_TREE.values():
        for item in group["items"]:
            permissions.append(item["value"])
    return permissions

ALL_PERMISSIONS = get_all_permissions_values()

BASIC_PERMISSIONS = [
    # User Profile
    "user:me",
    "user:password",
    # Read Access
    "location:read",
    "identification_type:read",
    "environment_type:read",
    # Environment Management (Scoped by logic)
    "environment:read",
    "environment:create",
    "environment:update",
    "environment:delete",
    # Invitations
    "invitation:read",
    "invitation:create",
    "invitation:delete",
    # Scoped access
    "access:read",
    # Devices
    "device:read",
    "device:pair",
    "device:update",
    # Sensor readings
    "sensor:read",
    "sensor_catalog:read",
    "device_sensor:read",
    "device_sensor:write",
    "telemetry:read",
]
