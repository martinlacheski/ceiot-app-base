import type { HistoryTelemetryItem, HistoryTelemetrySensor } from "@/api/deviceHistory.api";
import type { HistoryColumn } from "./HistoryResultsTable";
import { formatDateTime } from "@/utils/date.utils";

export function formatTelemetryValue(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value);
  return unit ? `${number} ${unit}` : number;
}

export function mergeTelemetrySensors(...pages: HistoryTelemetrySensor[][]): HistoryTelemetrySensor[] {
  const byKey = new Map<string, HistoryTelemetrySensor>();
  for (const sensors of pages) for (const sensor of sensors) {
    const existing = byKey.get(sensor.key);
    if (!existing) byKey.set(sensor.key, { ...sensor, variables: [...sensor.variables] });
    else for (const variable of sensor.variables) {
      if (!existing.variables.some((item) => item.code === variable.code)) existing.variables.push(variable);
    }
  }
  return [...byKey.values()];
}

export function buildTelemetryColumns(sensors: HistoryTelemetrySensor[]): HistoryColumn<HistoryTelemetryItem>[] {
  return [
    { id: "time", title: "Fecha/Hora", value: (item) => formatDateTime(item.time), sortable: true },
    ...sensors.flatMap((sensor) => sensor.variables.map((variable) => ({
      id: `${sensor.key}:${variable.code}`,
      title: `${sensor.sensorName} · ${variable.name}${variable.unit ? ` (${variable.unit})` : ""}`,
      value: (item: HistoryTelemetryItem) => formatTelemetryValue(item.values[sensor.key]?.[variable.code], variable.unit),
    }))),
  ];
}
