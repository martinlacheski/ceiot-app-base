import { ROLLING_RANGE_MS } from "@/app/live/telemetryCachePatch";
import type { Device } from "@/app/types/device.types";
import type { AggregateBucket } from "@/app/types/environmentalSensor.types";

export type ReadingsRange = "1h" | "24h" | "7d" | "30d";

export const READINGS_RANGES: Array<{ id: ReadingsRange; label: string; description: string }> = [
  { id: "1h", label: "1h", description: "Última hora" },
  { id: "24h", label: "24h", description: "Últimas 24 horas" },
  { id: "7d", label: "7d", description: "Últimos 7 días" },
  { id: "30d", label: "30d", description: "Últimos 30 días" },
];

/** Recent readings fetched for the records table. */
export const RECENT_READINGS_LIMIT = 10;

/**
 * The period the readings cover: a preset is a rolling window that ends now (and follows
 * the live pulse); a custom period is a fixed window, picked or reached with prev/next.
 */
export type ReadingsPeriod =
  | { kind: "preset"; range: ReadingsRange }
  | { kind: "custom"; start: number; end: number };

export const presetPeriod = (range: ReadingsRange): ReadingsPeriod => ({ kind: "preset", range });

export const isLivePeriod = (period: ReadingsPeriod) => period.kind === "preset";

export interface ReadingsWindow {
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

/** Bounds of the period: the rolling window that ends at `now`, or the fixed custom bounds. */
export function periodWindow(period: ReadingsPeriod, now: number): ReadingsWindow {
  if (period.kind === "custom") return { start: period.start, end: period.end };
  const duration = ROLLING_RANGE_MS[period.range] ?? ROLLING_RANGE_MS["24h"];
  return { start: now - duration, end: now };
}

/**
 * Start and end parts of the aggregate query key. A preset is keyed by its id and "now", so the
 * key stays stable while the window rolls (the bounds are resolved when the query runs) and the
 * live pulse can recognize it; a custom window is keyed by its ISO bounds.
 */
export function periodQueryKey(period: ReadingsPeriod): [string, string] {
  if (period.kind === "preset") return [period.range, "now"];
  return [new Date(period.start).toISOString(), new Date(period.end).toISOString()];
}

/** Only a window that ends before now can move forward. */
export const canShiftForward = (period: ReadingsPeriod, now: number) => period.kind === "custom" && period.end < now;

/**
 * The window moved by its own span. Moving forward up to now returns to the matching live
 * preset; a span without preset is clamped to a fixed window that ends now.
 */
export function shiftPeriod(period: ReadingsPeriod, direction: -1 | 1, now: number): ReadingsPeriod {
  const { start, end } = periodWindow(period, now);
  const span = end - start;
  if (direction === -1) return { kind: "custom", start: start - span, end: end - span };
  if (!canShiftForward(period, now)) return period;
  if (end + span < now) return { kind: "custom", start: start + span, end: end + span };
  const preset = READINGS_RANGES.find((range) => ROLLING_RANGE_MS[range.id] === span);
  return preset ? presetPeriod(preset.id) : { kind: "custom", start: now - span, end: now };
}

/** Longest window the aggregate endpoint accepts. */
export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Error message for an invalid custom range, or null when it can be requested. */
export function validateCustomRange(start: Date | undefined, end: Date | undefined): string | null {
  if (!start || !end) return "Elegí la fecha desde y la fecha hasta.";
  if (end.getTime() <= start.getTime()) return "La fecha hasta tiene que ser posterior a la fecha desde.";
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) return `El período no puede superar los ${MAX_PERIOD_DAYS} días.`;
  return null;
}

export type AggregationLevel = "auto" | AggregateBucket;

export const BUCKET_SECONDS: Record<AggregateBucket, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "1d": 24 * 60 * 60,
};

export const BUCKET_LABEL: Record<AggregateBucket, string> = {
  "1m": "1 min",
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 h",
  "6h": "6 h",
  "1d": "1 día",
};

export const AGGREGATION_LEVELS: Array<{ id: AggregationLevel; label: string }> = [
  { id: "auto", label: "Automático" },
  ...(Object.keys(BUCKET_LABEL) as AggregateBucket[]).map((id) => ({ id, label: BUCKET_LABEL[id] })),
];

/** The backend refuses an explicit bucket that would produce more buckets than this (a week of minutes). */
export const MAX_AGGREGATE_BUCKETS = 7 * 24 * 60;

/** `auto` always fits; an explicit bucket fits while the span holds at most `MAX_AGGREGATE_BUCKETS` of it. */
export function aggregationAllowed(level: AggregationLevel, spanMs: number): boolean {
  return level === "auto" || Math.ceil(spanMs / (BUCKET_SECONDS[level] * 1000)) <= MAX_AGGREGATE_BUCKETS;
}

/** The chosen level, or automatic when it no longer fits the span (it comes back with a shorter one). */
export const effectiveAggregation = (level: AggregationLevel, spanMs: number): AggregationLevel =>
  aggregationAllowed(level, spanMs) ? level : "auto";

export type AggregateFunction = "avg" | "min" | "max";

export const AGGREGATE_FUNCTIONS: Array<{ id: AggregateFunction; label: string }> = [
  { id: "avg", label: "Promedio" },
  { id: "min", label: "Mínimo" },
  { id: "max", label: "Máximo" },
];

/** More bands than this overlap into an unreadable wash. */
export const BAND_MAX_SERIES = 4;

/** The min–max band only makes sense around the average, and only for a few visible series. */
export const canShowBand = (fn: AggregateFunction, visibleSeries: number) =>
  fn === "avg" && visibleSeries <= BAND_MAX_SERIES;

export interface FleetPresence {
  online: number;
  offline: number;
  unknown: number;
}

export function countPresence(devices: Device[]): FleetPresence {
  return devices.reduce<FleetPresence>((counts, device) => {
    if (device.brokerConnected === true) counts.online += 1;
    else if (device.brokerConnected === false) counts.offline += 1;
    else counts.unknown += 1;
    return counts;
  }, { online: 0, offline: 0, unknown: 0 });
}

const PRESENCE_ORDER = (device: Device) =>
  device.brokerConnected === true ? 0 : device.brokerConnected === false ? 1 : 2;

/** Online first, then offline, then devices without presence data; stable within each group. */
export function sortByPresence(devices: Device[]): Device[] {
  return [...devices].sort((a, b) => PRESENCE_ORDER(a) - PRESENCE_ORDER(b));
}

/** The requested device when it is still listed; otherwise the first online one, else the first. */
export function pickSelectedDevice(devices: Device[], requestedId: string | null): Device | undefined {
  return devices.find((device) => device.id === requestedId)
    ?? devices.find((device) => device.brokerConnected === true)
    ?? devices[0];
}

export const deviceLabel = (device: Device) => device.name || device.serial;
