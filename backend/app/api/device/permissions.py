class DevicePermissions:
    READ = "device:read"
    CREATE = "device:create"
    UPDATE = "device:update"
    DELETE = "device:delete"
    PAIR = "device:pair" 
    READ_ALL = "device:read_all"

    @classmethod
    def all_permissions(cls):
        return [cls.READ, cls.CREATE, cls.UPDATE, cls.DELETE, cls.PAIR, cls.READ_ALL]

DEVICES_PERMISSIONS = {
    "label": "Dispositivos",
    "items": [
        {"value": DevicePermissions.READ, "label": "Ver Dispositivos"},
        {"value": DevicePermissions.READ_ALL, "label": "Ver Todos los Dispositivos"},
        {"value": DevicePermissions.CREATE, "label": "Crear Dispositivos"},
        {"value": DevicePermissions.UPDATE, "label": "Editar Dispositivos"},
        {"value": DevicePermissions.DELETE, "label": "Eliminar Dispositivos"},
        {"value": DevicePermissions.PAIR, "label": "Vincular/Desvincular Dispositivos"},
    ]
}
