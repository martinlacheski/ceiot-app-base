import { format } from "date-fns";

import type { DailyTelemetry, TelemetryItem, TelemetrySensor } from "@/app/types/environmentalSensor.types";
import { datetimeCell, dateCell, decimalCell, integerCell, type ExportCell } from "@/lib/export.cells";
import { toFilenamePart } from "@/lib/downloadReport";
import { formatDate, formatDateTime } from "@/utils/date.utils";
import { buildTelemetryColumns, formatTelemetryValue, telemetryDecimals } from "./historyTelemetryColumns";

export type TelemetryReportKind = "daily" | "detailed";

export const DAILY_REPORT_TITLE = "Resumen diario de telemetría";
export const DETAILED_REPORT_TITLE = "Telemetría detallada";
export const NO_READINGS_MESSAGE = "No hay lecturas en el período seleccionado.";

const STATS = [["min", "Mín"], ["max", "Máx"], ["avg", "Prom"]] as const;

/** Minutes east of UTC for the browser at `date` (local = UTC + offset); what the daily endpoint buckets by. */
export const localUtcOffsetMinutes = (date: Date): number => -date.getTimezoneOffset();

const formatPeriodEdge = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm");

export function reportSubtitle(device: { name?: string | null; serial: string }, start: string, end: string): string {
  const label = device.name ? `${device.name} (${device.serial})` : device.serial;
  return `Dispositivo: ${label} · Período: ${formatPeriodEdge(start)} - ${formatPeriodEdge(end)}`;
}

export function reportFilename(kind: TelemetryReportKind, serial: string, start: string, end: string): string {
  const prefix = kind === "daily" ? "resumen-diario-telemetria" : "telemetria-detallada";
  const day = (iso: string) => format(new Date(iso), "yyyy-MM-dd");
  return `${prefix}_${toFilenamePart(serial)}_${day(start)}_${day(end)}`;
}

export const sensorVariableTitle = (sensor: TelemetrySensor, variable: TelemetrySensor["variables"][number]) =>
  `${sensor.sensorName} · ${variable.name}${variable.unit ? ` (${variable.unit})` : ""}`;

/** Total readings of a day: the busiest variable (variables of one sensor share each reading). */
export const dailyReadings = (day: DailyTelemetry["days"][number]): number =>
  Math.max(0, ...Object.values(day.sensors).flatMap((variables) => Object.values(variables).map((stat) => stat.count)));

export function formatDailyDate(date: string): string {
  return formatDate(date);
}

export function buildDailyExport({ days, sensors }: DailyTelemetry): { columns: string[]; data: ExportCell[][] } {
  const columns = [
    "Fecha",
    ...sensors.flatMap((sensor) => sensor.variables.flatMap((variable) =>
      STATS.map(([, label]) => `${sensorVariableTitle(sensor, variable)} · ${label}`))),
    "Lecturas",
  ];
  const data = days.map((day) => [
    dateCell(day.date, formatDailyDate(day.date)),
    ...sensors.flatMap((sensor) => sensor.variables.flatMap((variable) => STATS.map(([stat]) => {
      const value = day.sensors[sensor.key]?.[variable.code]?.[stat];
      return decimalCell(value ?? null, formatTelemetryValue(value, variable.unit), telemetryDecimals(variable.code));
    }))),
    integerCell(dailyReadings(day), String(dailyReadings(day))),
  ]);
  return { columns, data };
}

export function buildDetailedExport(rows: TelemetryItem[], sensors: TelemetrySensor[]): { columns: string[]; data: ExportCell[][] } {
  const columns = buildTelemetryColumns(sensors);
  return {
    columns: columns.map((column, index) => (index === 0 ? "Fecha y hora" : column.title)),
    data: rows.map((row) => columns.map((column, index) => index === 0
      ? datetimeCell(row.time, formatDateTime(row.time))
      : column.exportValue!(row))),
  };
}
