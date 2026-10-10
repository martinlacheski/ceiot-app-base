import type { TelemetryPage, TelemetryVariable } from "@/app/types/environmentalSensor.types";

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
