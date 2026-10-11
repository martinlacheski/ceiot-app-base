import type { LiveTelemetry, TelemetryPage, TelemetryVariable } from "@/app/types/environmentalSensor.types";

export interface CurrentValue {
  /** `<sensorKey>:<variableCode>`. */
  id: string;
  sensorName: string;
  variable: TelemetryVariable;
  /** Newest non-null reading, or null when the recent records carry none. */
  value: number | null;
}

/** Newest value of every sensor variable in a page of recent readings, plus the newest reading time. */
export function collectCurrentValues(page?: TelemetryPage): { values: CurrentValue[]; lastTime?: string } {
  if (!page) return { values: [], lastTime: undefined };
  const items = [...page.items].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const values = page.sensors.flatMap((sensor) => sensor.variables.map((variable) => {
    const reading = items
      .map((item) => item.values[sensor.key]?.[variable.code])
      .find((value): value is number => typeof value === "number" && Number.isFinite(value));
    return { id: `${sensor.key}:${variable.code}`, sensorName: sensor.sensorName, variable, value: reading ?? null };
  }));
  return { values, lastTime: items[0]?.time };
}

/** Every described sensor variable of the live state, plus the time of its latest reading. */
export function collectLiveValues(live?: LiveTelemetry): { values: CurrentValue[]; lastTime?: string } {
  if (!live) return { values: [], lastTime: undefined };
  const items = live.time ? [{ time: live.time, values: live.values }] : [];
  return collectCurrentValues({ items, total: items.length, sensors: live.sensors });
}

/** Qualitative WiFi signal from its RSSI in dBm. */
export function wifiQuality(rssi: number): string {
  if (rssi >= -50) return "Excelente";
  if (rssi >= -60) return "Buena";
  if (rssi >= -70) return "Regular";
  return "Débil";
}

export interface DeviceHealth {
  wifi?: { rssi: number; quality: string };
  firmware?: string;
}

/** The health fields worth showing next to the current values; anything unusable is left out. */
export function deviceHealth(health?: Record<string, unknown>): DeviceHealth {
  const result: DeviceHealth = {};
  const rssi = health?.wifi_rssi;
  if (typeof rssi === "number" && Number.isFinite(rssi)) result.wifi = { rssi, quality: wifiQuality(rssi) };
  const firmware = health?.firmware_version;
  if (typeof firmware === "string" && firmware.trim()) result.firmware = firmware.trim();
  return result;
}
