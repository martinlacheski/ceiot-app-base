import type { Device } from "@/app/types/device.types";
import type { TelemetryPage, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import type { ReadingsRange } from "./overviewModel";

const MINUTE_MS = 60 * 1000;

/** Bucket width used to align readings of different devices on one time axis. */
export const BUCKET_MS: Record<ReadingsRange, number> = {
  "1h": MINUTE_MS,
  "24h": 10 * MINUTE_MS,
  "7d": 60 * MINUTE_MS,
};

export const BUCKET_LABEL: Record<ReadingsRange, string> = {
  "1h": "1 minuto",
  "24h": "10 minutos",
  "7d": "1 hora",
};

export interface DeviceHistory {
  deviceId: string;
  deviceName: string;
  page?: TelemetryPage;
}

export interface EnvironmentSeries {
  /** Chart data key; also used for the `--color-<key>` CSS variable. */
  key: string;
  label: string;
  deviceId: string;
  sensorKey: string;
}

export interface EnvironmentPoint {
  /** Bucket start, epoch milliseconds. */
  time: number;
  [seriesKey: string]: number | null;
}

/** Union of the variables reported by every device sensor, first occurrence wins. */
export function collectVariables(histories: DeviceHistory[]): TelemetryVariable[] {
  const byCode = new Map<string, TelemetryVariable>();
  for (const { page } of histories) {
    for (const sensor of page?.sensors ?? []) {
      for (const variable of sensor.variables) {
        if (!byCode.has(variable.code)) byCode.set(variable.code, variable);
      }
    }
  }
  return [...byCode.values()];
}

export function defaultVariableCode(variables: TelemetryVariable[]): string | undefined {
  return variables.find((variable) => variable.code === "temperature")?.code ?? variables[0]?.code;
}

/** Names a series from its device and sensor names. */
export type SeriesLabel = (deviceName: string, sensorName: string) => string;

export const deviceSensorLabel: SeriesLabel = (deviceName, sensorName) => `${deviceName} · ${sensorName}`;
/** For a single device, where repeating its name on every series adds nothing. */
export const sensorLabel: SeriesLabel = (_deviceName, sensorName) => sensorName;

export interface SeriesOptions {
  /** Names each series; defaults to "device · sensor". */
  label?: SeriesLabel;
  /**
   * Epoch milliseconds: readings before it are left out. Keeps a rolling window moving
   * while a quiet device sends nothing that would trim its cached history.
   */
  since?: number;
}

/**
 * One series per device sensor that measures `variableCode`, merged on a shared time axis:
 * readings are grouped in `bucketMs` buckets and averaged per series, ignoring nulls.
 * Buckets without any value are dropped; a series without values in a bucket gets null.
 */
export function buildEnvironmentSeries(
  histories: DeviceHistory[],
  variableCode: string,
  bucketMs: number,
  { label = deviceSensorLabel, since = -Infinity }: SeriesOptions = {},
): { series: EnvironmentSeries[]; points: EnvironmentPoint[] } {
  const series: EnvironmentSeries[] = [];
  const buckets = new Map<number, Map<string, { sum: number; count: number }>>();

  for (const { deviceId, deviceName, page } of histories) {
    if (!page) continue;
    for (const sensor of page.sensors) {
      if (!sensor.variables.some((variable) => variable.code === variableCode)) continue;
      const key = `s${series.length}`;
      series.push({ key, label: label(deviceName, sensor.sensorName), deviceId, sensorKey: sensor.key });

      for (const item of page.items) {
        const value = item.values[sensor.key]?.[variableCode];
        const time = Date.parse(item.time);
        if (value === null || value === undefined || Number.isNaN(time) || time < since) continue;
        const bucketStart = Math.floor(time / bucketMs) * bucketMs;
        const bucket = buckets.get(bucketStart) ?? new Map<string, { sum: number; count: number }>();
        const total = bucket.get(key) ?? { sum: 0, count: 0 };
        bucket.set(key, { sum: total.sum + value, count: total.count + 1 });
        buckets.set(bucketStart, bucket);
      }
    }
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, bucket]) => {
      const point: EnvironmentPoint = { time };
      for (const { key } of series) {
        const total = bucket.get(key);
        point[key] = total ? total.sum / total.count : null;
      }
      return point;
    });

  return { series, points };
}

/** The newest `limit` buckets, newest first, for the table view. */
export function latestPoints(points: EnvironmentPoint[], limit: number): EnvironmentPoint[] {
  return points.slice(-limit).reverse();
}

const CHART_TOKENS = 5;
/** Dash patterns that keep series apart once the five chart colors repeat. */
const DASHES = ["6 4", "2 3", "10 3 2 3"];

export function seriesStroke(index: number): { color: string; dash?: string } {
  const color = `var(--chart-${(index % CHART_TOKENS) + 1})`;
  const cycle = Math.floor(index / CHART_TOKENS);
  return cycle === 0 ? { color } : { color, dash: DASHES[(cycle - 1) % DASHES.length] };
}

/** Establishments that have at least one loaded device, sorted by name. */
export function listDeviceEnvironments(devices: Device[]): Array<{ id: string; name: string }> {
  const byId = new Map<string, { id: string; name: string }>();
  for (const device of devices) {
    if (device.environment && !byId.has(device.environment.id)) {
      byId.set(device.environment.id, { id: device.environment.id, name: device.environment.name });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
