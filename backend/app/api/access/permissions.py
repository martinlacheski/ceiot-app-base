class AccessPermissions:
    READ = "access:read"
    MANAGE = "access:manage"

    @classmethod
    def all_permissions(cls) -> list[str]:
        return [cls.READ, cls.MANAGE]


ACCESS_PERMISSIONS = {
    "label": "Accesos compartidos",
    "items": [
        {
            "value": AccessPermissions.READ,
            "label": "Ver accesos compartidos",
        },
        {
            "value": AccessPermissions.MANAGE,
            "label": "Gestionar invitados",
        },
    ],
}
