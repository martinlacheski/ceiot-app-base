class AccessPermissions:
    READ = "access:read"
    MANAGE = "access:manage"

    @classmethod
    def all_permissions(cls) -> list[str]:
        return [cls.READ, cls.MANAGE]


ACCESS_PERMISSIONS = {
    "label": "Access",
    "items": [
        {
            "value": AccessPermissions.READ,
            "label": "Ver acceso contextual",
        },
        {
            "value": AccessPermissions.MANAGE,
            "label": "Gestionar invitados y comisión por alcance",
        },
    ],
}
