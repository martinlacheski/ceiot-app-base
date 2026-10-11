export interface SensorVariable {
  code: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  accuracy: string;
  resolution: string;
}

export interface SensorCatalogModel {
  id: string;
  code: string;
  name: string;
  manufacturer: string;
  variables: SensorVariable[];
}

export interface DeviceSensor {
  id: string;
  deviceId: string;
  sensorId: string;
  key: string;
  config: Record<string, unknown>;
  isActive: boolean;
  installedAt: string | null;
  removedAt: string | null;
}

export interface TelemetryVariable {
  code: string;
  name: string;
  unit: string;
}

export interface TelemetrySensor {
  key: string;
  sensorCode: string;
  sensorName: string;
  variables: TelemetryVariable[];
}

export interface TelemetryItem {
  time: string;
  values: Record<string, Record<string, number | null>>;
}

export interface TelemetryPage {
  items: TelemetryItem[];
  total: number;
  sensors: TelemetrySensor[];
  page?: number;
  perPage?: number;
  pages?: number;
}

/** Latest known state of a device: the Redis live cache, or the newest stored row as fallback. */
export interface LiveTelemetry {
  source: "redis" | "database";
  /** Time of the latest reading; null when the device never reported one. */
  time: string | null;
  values: TelemetryItem["values"];
  /** Last health fields the device reported (`wifi_rssi`, `firmware_version`, `uptime`, ...). */
  health: Record<string, unknown>;
  /** Broker presence last seen by the runtime ("online"/"offline"), Redis only. */
  presence: string | null;
  sensors: TelemetrySensor[];
}

export interface DailyStat {
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface DailyTelemetryDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  sensors: Record<string, Record<string, DailyStat>>;
}

export interface DailyTelemetry {
  days: DailyTelemetryDay[];
  sensors: TelemetrySensor[];
}

/** Aggregation levels of `/telemetry/aggregate`, finest first. */
export type AggregateBucket = "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

/** avg/min/max/count of the numeric readings of one variable in one bucket. */
export interface AggregateStat {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface AggregateItem {
  /** Bucket start (UTC). */
  time: string;
  values: Record<string, Record<string, AggregateStat>>;
}

/** Readings of a window grouped in time buckets; items ascending by bucket start. */
export interface AggregateTelemetry {
  /** Bucket actually used (the resolved one for `auto`). */
  bucket: AggregateBucket;
  bucketSeconds: number;
  start: string;
  end: string;
  items: AggregateItem[];
  sensors: TelemetrySensor[];
}
