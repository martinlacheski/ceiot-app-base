export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const TELEMETRY_INTERVAL_RANGE = [5, 86400] as const;
export const OFFLINE_AFTER_RANGE = [10, 604800] as const;

export interface DeviceTypeFormValues {
  code: string;
  name: string;
  hardwareModel: string;
  description: string;
  telemetryIntervalS: string;
  offlineAfterS: string;
  minSensors: string;
  configTemplate: string;
}

export interface DeviceTypeSensorRow {
  sensorId: string;
  required: boolean;
  maxCount: number | "";
  includedByDefault: boolean;
}

export const CONFIG_ERROR = "La plantilla de configuración debe ser un objeto JSON válido.";

export function parseConfigTemplate(text: string): { value: Record<string, unknown> } | { error: string } {
  if (!text.trim()) return { value: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { value: parsed as Record<string, unknown> };
  } catch {
    // Falls through to the shared message.
  }
  return { error: CONFIG_ERROR };
}

const toInteger = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
};

export function validateDeviceTypeForm(
  values: DeviceTypeFormValues,
  rows: DeviceTypeSensorRow[],
  { creating }: { creating: boolean },
): string | null {
  if (creating && !SLUG_PATTERN.test(values.code)) return "El código debe ser un identificador en minúsculas, sin espacios.";
  if (!values.name.trim()) return "Completa el nombre.";

  const interval = values.telemetryIntervalS.trim() ? toInteger(values.telemetryIntervalS) : undefined;
  if (interval === null || (interval !== undefined && (interval < TELEMETRY_INTERVAL_RANGE[0] || interval > TELEMETRY_INTERVAL_RANGE[1]))) {
    return `El intervalo de telemetría debe estar entre ${TELEMETRY_INTERVAL_RANGE[0]} y ${TELEMETRY_INTERVAL_RANGE[1]} segundos.`;
  }
  const offline = values.offlineAfterS.trim() ? toInteger(values.offlineAfterS) : undefined;
  if (offline === null || (offline !== undefined && (offline < OFFLINE_AFTER_RANGE[0] || offline > OFFLINE_AFTER_RANGE[1]))) {
    return `El tiempo sin conexión debe estar entre ${OFFLINE_AFTER_RANGE[0]} y ${OFFLINE_AFTER_RANGE[1]} segundos.`;
  }
  if (interval !== undefined && offline !== undefined && offline < interval) {
    return "El tiempo sin conexión no puede ser menor que el intervalo de telemetría.";
  }

  const minSensors = values.minSensors.trim() ? toInteger(values.minSensors) : 0;
  if (minSensors === null || minSensors < 0) return "El mínimo de sensores debe ser un entero mayor o igual a 0.";

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.sensorId) return "Selecciona un sensor en cada fila.";
    if (seen.has(row.sensorId)) return "Un sensor no puede repetirse.";
    seen.add(row.sensorId);
    if (row.maxCount === "" || !Number.isInteger(row.maxCount) || row.maxCount < 1) return "El máximo debe ser un entero mayor o igual a 1.";
  }
  const capacity = rows.reduce((total, row) => total + (row.maxCount === "" ? 0 : row.maxCount), 0);
  if (minSensors > capacity) {
    return rows.length
      ? "El mínimo de sensores supera la cantidad máxima de sensores compatibles."
      : "Para exigir sensores agrega al menos un sensor compatible.";
  }
  if ("error" in parseConfigTemplate(values.configTemplate)) return CONFIG_ERROR;
  return null;
}

export interface DeviceTypePayload {
  code?: string;
  name: string;
  description: string | null;
  hardwareModel: string | null;
  telemetryIntervalS: number | null;
  offlineAfterS: number | null;
  minSensors: number;
  configTemplate: Record<string, unknown>;
  sensors: { sensorId: string; required: boolean; maxCount: number; includedByDefault: boolean }[];
}

const optionalInteger = (text: string) => (text.trim() ? Number(text.trim()) : null);

/** Only call after `validateDeviceTypeForm` returned null. */
export function buildPayload(values: DeviceTypeFormValues, rows: DeviceTypeSensorRow[], { creating }: { creating: boolean }): DeviceTypePayload {
  const parsed = parseConfigTemplate(values.configTemplate);
  return {
    ...(creating ? { code: values.code } : {}),
    name: values.name.trim(),
    description: values.description.trim() || null,
    hardwareModel: values.hardwareModel.trim() || null,
    telemetryIntervalS: optionalInteger(values.telemetryIntervalS),
    offlineAfterS: optionalInteger(values.offlineAfterS),
    minSensors: values.minSensors.trim() ? Number(values.minSensors.trim()) : 0,
    configTemplate: "value" in parsed ? parsed.value : {},
    sensors: rows.map((row) => ({ sensorId: row.sensorId, required: row.required, maxCount: Number(row.maxCount), includedByDefault: row.includedByDefault })),
  };
}
