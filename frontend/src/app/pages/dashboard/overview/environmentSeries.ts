import type { Device } from "@/app/types/device.types";
import type { AggregateTelemetry, TelemetrySensor, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import type { AggregateFunction } from "./overviewModel";

/** Bucketed readings of one device, as last loaded. */
export interface DeviceAggregate {
  deviceId: string;
  deviceName: string;
  data?: AggregateTelemetry;
}

export interface EnvironmentSeries {
  /** Chart data key; also used for the `--color-<key>` CSS variable. */
  key: string;
  label: string;
  deviceId: string;
  sensorKey: string;
}

/** Bucket min and max of a series, drawn as a band behind its line. */
export type BandRange = [number, number];

export interface EnvironmentPoint {
  /** Bucket start, epoch milliseconds. */
  time: number;
  /** `<seriesKey>`: the plotted value; `bandKey(seriesKey)`: its bucket min–max. */
  [seriesKey: string]: number | BandRange | null;
}

/** Data key of the min–max band of a series. */
export const bandKey = (seriesKey: string) => `${seriesKey}Band`;

/** The plotted value of a series in a point (never its band). */
export const pointValue = (point: EnvironmentPoint, seriesKey: string): number | null => {
  const value = point[seriesKey];
  return typeof value === "number" ? value : null;
};

/** Union of the variables reported by every device sensor, first occurrence wins. */
export function collectVariables(sources: Array<{ data?: { sensors: TelemetrySensor[] } }>): TelemetryVariable[] {
  const byCode = new Map<string, TelemetryVariable>();
  for (const { data } of sources) {
    for (const sensor of data?.sensors ?? []) {
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
  /** Bucket statistic plotted as the series value; defaults to the average. */
  fn?: AggregateFunction;
  /**
   * Epoch milliseconds: buckets that ended before it are left out. Keeps a rolling window
   * moving while a quiet device sends nothing that would trim its cached aggregate.
   */
  since?: number;
}

/**
 * One series per device sensor that measures `variableCode`, merged on the bucket starts
 * (every device is aggregated with the same bucket and origin). Each point holds the chosen
 * statistic per series (null when that series has no reading in the bucket) and its min–max
 * band. Buckets without any value for the variable are dropped.
 */
export function buildEnvironmentSeries(
  aggregates: DeviceAggregate[],
  variableCode: string,
  { label = deviceSensorLabel, fn = "avg", since = -Infinity }: SeriesOptions = {},
): { series: EnvironmentSeries[]; points: EnvironmentPoint[] } {
  const series: EnvironmentSeries[] = [];
  const buckets = new Map<number, EnvironmentPoint>();

  for (const { deviceId, deviceName, data } of aggregates) {
    if (!data) continue;
    const bucketMs = data.bucketSeconds * 1000;
    for (const sensor of data.sensors) {
      if (!sensor.variables.some((variable) => variable.code === variableCode)) continue;
      const key = `s${series.length}`;
      series.push({ key, label: label(deviceName, sensor.sensorName), deviceId, sensorKey: sensor.key });

      for (const item of data.items) {
        const stat = item.values[sensor.key]?.[variableCode];
        const time = Date.parse(item.time);
        if (!stat || Number.isNaN(time) || time + bucketMs <= since) continue;
        const point = buckets.get(time) ?? { time };
        point[key] = stat[fn];
        point[bandKey(key)] = [stat.min, stat.max];
        buckets.set(time, point);
      }
    }
  }

  const points = [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map((point) => {
      const filled: EnvironmentPoint = { ...point };
      for (const { key } of series) {
        filled[key] ??= null;
        filled[bandKey(key)] ??= null;
      }
      return filled;
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
