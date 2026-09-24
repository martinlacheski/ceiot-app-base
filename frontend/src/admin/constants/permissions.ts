export const PERMISSIONS = {
  SENSOR_CATALOG: {
    label: "Catálogo de sensores",
    items: [
      { value: "sensor_catalog:read", label: "Ver catálogo de sensores" },
      { value: "sensor_catalog:write", label: "Administrar catálogo de sensores" },
    ],
  },
  USERS: {
    label: "Usuarios",
    items: [
      { value: "user:read", label: "Ver Usuarios" },
      { value: "user:create", label: "Crear Usuarios" },
      { value: "user:update", label: "Editar Usuarios" },
      { value: "user:delete", label: "Eliminar Usuarios" },
      { value: "user:me", label: "Ver Perfil" },
      { value: "user:password", label: "Cambiar Contraseña" },
    ],
  },
  LOCATIONS: {
    label: "Ubicaciones",
    items: [
      { value: "location:read", label: "Ver Ubicaciones" },
      { value: "location:create", label: "Crear Ubicaciones" },
      { value: "location:update", label: "Editar Ubicaciones" },
      { value: "location:delete", label: "Eliminar Ubicaciones" },
    ],
  },
  DOCUMENT_TYPES: {
    label: "Tipos de Documentos",
    items: [
      { value: "identification_type:read", label: "Ver Tipos de Documentos" },
      {
        value: "identification_type:create",
        label: "Crear Tipos de Documentos",
      },

      {
        value: "identification_type:update",
        label: "Editar Tipos de Documentos",
      },
      {
        value: "identification_type:delete",
        label: "Eliminar Tipos de Documentos",
      },
    ],
  },
  ENVIRONMENTS: {
    label: "Establecimientos",
    items: [
      { value: "environment:read", label: "Ver Establecimientos" },
      { value: "environment:create", label: "Crear Establecimientos" },
      { value: "environment:delete", label: "Eliminar Establecimientos" },
    ],
  },
  DEVICES: {
    label: "Dispositivos",
    items: [
      { value: "device:read", label: "Ver Dispositivos" },
      { value: "device:read_all", label: "Ver Todos los Dispositivos" },
      { value: "device:create", label: "Crear Dispositivos" },
      { value: "device:update", label: "Editar Dispositivos" },
      { value: "device:delete", label: "Eliminar Dispositivos" },
      { value: "device:pair", label: "Vincular/Desvincular Dispositivos" },
    ],
  },
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flatMap((group) =>
  group.items.map((p) => p.value),
);
