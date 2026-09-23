/** Display-only labels. API payloads, URL values, and filter values remain codes. */

export const DEVICE_STATUS_LABELS: Record<string, string> = {
  new: "NUEVO",
  paired: "VINCULADO",
  active: "ACTIVO",
  maintenance: "MANTENIMIENTO",
  unpaired: "DESVINCULADO",
};

export const OPERATION_TYPE_LABELS: Record<string, string> = {
  sensor_data: "Datos de sensores",
  keep_active: "Dispositivo activo",
  session_request: "Solicitud de sesión",
  error: "Error",
  other: "Otro",
};

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  success: "Exitoso",
  failed: "Fallido",
  pending: "Pendiente",
};

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  declined: "Rechazada",
  revoked: "Revocada",
};

export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  online: "En línea",
  offline: "Fuera de línea",
};

export const ENVIRONMENT_ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  guest: "Invitado",
};

export const DEVICE_LOCATION_SOURCE_LABELS: Record<string, string> = {
  device_gps: "GPS",
  environment: "Establecimiento",
};

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function humanizeCode(value: unknown): string {
  const text = toText(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const labelFrom = (labels: Record<string, string>) => (value: unknown): string => {
  const text = toText(value).trim();
  if (!text) return "";
  const key = text.toLowerCase();
  return Object.prototype.hasOwnProperty.call(labels, key)
    ? labels[key]
    : humanizeCode(text);
};

export const getDeviceStatusLabel = labelFrom(DEVICE_STATUS_LABELS);
export const getOperationTypeLabel = labelFrom(OPERATION_TYPE_LABELS);
export const getOperationStatusLabel = labelFrom(OPERATION_STATUS_LABELS);
export const getInvitationStatusLabel = labelFrom(INVITATION_STATUS_LABELS);
export const getConnectionStatusLabel = labelFrom(CONNECTION_STATUS_LABELS);
export const getEnvironmentRoleLabel = labelFrom(ENVIRONMENT_ROLE_LABELS);
export const getDeviceLocationSourceCodeLabel = labelFrom(DEVICE_LOCATION_SOURCE_LABELS);
