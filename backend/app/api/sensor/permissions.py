class SensorPermissions:
    READ = "sensor:read"

    @classmethod
    def all_permissions(cls):
        return [cls.READ]


SENSOR_PERMISSIONS = {
    "label": "Lecturas de Sensores",
    "items": [
        {"value": SensorPermissions.READ, "label": "Ver Lecturas de Sensores"},
    ],
}
