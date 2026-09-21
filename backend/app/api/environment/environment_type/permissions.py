# Environment Types share permissions with Environments initially
ENVIRONMENT_TYPES_PERMISSIONS = {
    "label": "Tipos de Establecimientos",
    "items": [
        {"value": "environment_type:read", "label": "Ver Tipos de Establecimientos"},
    ]
}
# Currently reusing "environment:*" from ENVIRONMENTS_PERMISSIONS in logic.
# If we wanted specific permissions, we would define them here.
