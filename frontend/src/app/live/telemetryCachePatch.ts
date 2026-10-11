/**
 * Pure helpers that fold a live reading (carried by a telemetry pulse) into
 * cached telemetry pages, so the UI updates in place instead of refetching.
 *
 * Every helper returns an outcome instead of touching the cache:
 * - `patched`: replace the cached page with `page`;
 * - `unchanged`: nothing to do (no cache yet, or the reading is already there);
 * - `invalidate`: the reading cannot be folded safely (unknown sensor metadata,
 *   non-rolling period, unreadable time), so the query must be refetched.
 */
import type { QueryKey } from "@tanstack/react-query";

import type {
  AggregateItem,
  AggregateTelemetry,
  LiveTelemetry,
  TelemetryItem,
  TelemetryPage,
} from "@/app/types/environmentalSensor.types";

const HOUR_MS = 60 * 60 * 1000;

/** Rolling windows that end "now", by the range id used in history query keys. */
export const ROLLING_RANGE_MS: Record<string, number> = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
};

export type ReadingValues = TelemetryItem["values"];

export type PatchOutcome<T = TelemetryPage> =
  | { status: "patched"; page: T }
  | { status: "unchanged" }
  | { status: "invalidate" };

const UNCHANGED = { status: "unchanged" } as const;
const INVALIDATE = { status: "invalidate" } as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True for a non-empty `{ sensorKey: { variableCode: number | null } }` map. */
export function isReadingValues(value: unknown): value is ReadingValues {
  if (!isPlainObject(value)) return false;
  const sensors = Object.values(value);
  return sensors.length > 0 && sensors.every((variables) =>
    isPlainObject(variables)
    && Object.values(variables).every((reading) => reading === null || typeof reading === "number"));
}

/** Window length of `["telemetry", "history", id, range]`; null for custom or unknown periods. */
export function rollingRangeOf(key: QueryKey): number | null {
  if (key.length !== 4) return null;
  const range = key[3];
  return typeof range === "string" && Object.hasOwn(ROLLING_RANGE_MS, range) ? ROLLING_RANGE_MS[range] : null;
}

/** Row limit of `["telemetry", "latest", id, limit?]`; the API default is one row. */
export function latestLimit(key: QueryKey): number {
  const limit = key[3];
  return typeof limit === "number" && limit > 0 ? limit : 1;
}

/** Every sensor and variable of the reading is described by the page metadata. */
function describes(page: Pick<TelemetryPage, "sensors">, values: Record<string, Record<string, unknown>>): boolean {
  return Object.entries(values).every(([sensorKey, variables]) => {
    const sensor = page.sensors.find((entry) => entry.key === sensorKey);
    return sensor !== undefined
      && Object.keys(variables).every((code) => sensor.variables.some((variable) => variable.code === code));
  });
}

const epoch = (time: string) => Date.parse(time);

/**
 * Insert the reading newest first. A reading at an instant already cached
 * (whatever the ISO spelling) is a duplicate; an unreadable time is invalid.
 */
function insertReading(items: TelemetryItem[], reading: TelemetryItem): TelemetryItem[] | "duplicate" | "invalid" {
  const at = epoch(reading.time);
  if (Number.isNaN(at)) return "invalid";
  if (items.some((item) => epoch(item.time) === at)) return "duplicate";
  const index = items.findIndex((item) => epoch(item.time) < at);
  const position = index === -1 ? items.length : index;
  return [...items.slice(0, position), reading, ...items.slice(position)];
}

/**
 * Settle the folded rows and the page counters. `candidates` are the cached rows still
 * in place plus the reading when it belongs there, newest first; at most `capacity`
 * stay loaded. `removed` cached rows left the rolling window.
 *
 * - When cached rows left the window, every unloaded row (older than all loaded ones)
 *   left it too, so the total is the rows that remain.
 * - A reading sliced off a page with unloaded rows may repeat one of them: not counted.
 * - `pages` follows `total` whenever the page size is known.
 */
function settle(
  page: TelemetryPage,
  reading: TelemetryItem,
  candidates: TelemetryItem[],
  removed: number,
  capacity: number,
): PatchOutcome {
  const items = candidates.slice(0, capacity);
  const kept = items.includes(reading);
  const unloaded = Math.max(page.total - page.items.length, 0);
  const counted = candidates.includes(reading) && (kept || unloaded === 0) ? 1 : 0;
  const total = Math.max(unloaded > 0 && removed > 0 ? candidates.length : page.total - removed + counted, items.length);
  if (removed === 0 && !kept && total === page.total) return UNCHANGED;

  const settled: TelemetryPage = { ...page, items, total };
  if (typeof page.perPage === "number" && page.perPage > 0) settled.pages = Math.ceil(total / page.perPage);
  return { status: "patched", page: settled };
}

/** Fold a reading into a rolling history page (`items` newest first). */
export function patchHistoryPage(
  page: TelemetryPage | undefined,
  reading: TelemetryItem,
  rangeMs: number | null,
  now: number,
): PatchOutcome {
  if (rangeMs === null) return INVALIDATE;
  if (!page) return UNCHANGED;
  if (!describes(page, reading.values)) return INVALIDATE;
  const inserted = insertReading(page.items, reading);
  if (inserted === "invalid") return INVALIDATE;
  if (inserted === "duplicate") return UNCHANGED;

  const windowStart = now - rangeMs;
  const inWindow = inserted.filter((item) => epoch(item.time) >= windowStart);
  const removed = page.items.filter((item) => epoch(item.time) < windowStart).length;
  // A paginated page keeps its page size; a truncated one (only the newest rows of a larger
  // window) keeps its loaded size; a complete one holds the whole window.
  const truncated = page.items.length < page.total;
  const capacity = typeof page.perPage === "number" && page.perPage > 0
    ? page.perPage
    : truncated ? Math.max(page.items.length, 1) : Infinity;
  return settle(page, reading, inWindow, removed, capacity);
}

/** Fold a reading into a "latest N readings" page. */
export function patchLatestPage(page: TelemetryPage | undefined, reading: TelemetryItem, limit: number): PatchOutcome {
  if (!page) return UNCHANGED;
  if (!describes(page, reading.values)) return INVALIDATE;
  const inserted = insertReading(page.items, reading);
  if (inserted === "invalid") return INVALIDATE;
  if (inserted === "duplicate") return UNCHANGED;
  return settle(page, reading, inserted, 0, limit);
}

/**
 * Fold a reading into the cached live state of a device (`["telemetry", "live", id]`):
 * the time moves forward and the reading's variables replace the known ones, sensor by
 * sensor, so values the reading does not carry stay on screen. Health is not in the pulse
 * and stays as last fetched.
 */
export function patchLiveState(live: LiveTelemetry | undefined, reading: TelemetryItem): PatchOutcome<LiveTelemetry> {
  if (!live) return UNCHANGED;
  const at = epoch(reading.time);
  if (Number.isNaN(at)) return INVALIDATE;
  if (live.time !== null && at <= epoch(live.time)) return UNCHANGED;
  if (!describes(live, reading.values)) return INVALIDATE;
  const values = { ...live.values };
  for (const [sensorKey, variables] of Object.entries(reading.values)) {
    values[sensorKey] = { ...values[sensorKey], ...variables };
  }
  return { status: "patched", page: { ...live, time: reading.time, values } };
}

/** Browser offset from UTC in minutes (local = UTC + offset), as the aggregate endpoint expects it. */
export const localUtcOffsetMinutes = (at = Date.now()) => -new Date(at).getTimezoneOffset() || 0;

/** Same origin as the backend: a Monday at local midnight (2000-01-03T00:00 local). */
const BUCKET_ORIGIN_UTC = Date.UTC(2000, 0, 3);

/** Start of the bucket holding `time`; buckets are aligned on local midnight like `time_bucket` with the backend origin. */
export function bucketStartOf(time: number, bucketMs: number, utcOffsetMinutes: number): number {
  const origin = BUCKET_ORIGIN_UTC - utcOffsetMinutes * 60_000;
  return origin + Math.floor((time - origin) / bucketMs) * bucketMs;
}

/**
 * Window of `["telemetry", "aggregate", id, startKey, endKey, bucket]`: `live` when it ends
 * "now" (a preset), with the rolling span of the preset when known.
 */
export function aggregateWindowOf(key: QueryKey): { live: boolean; rangeMs: number | null } {
  const startKey = key[3];
  const live = key[4] === "now";
  const rangeMs = live && typeof startKey === "string" && Object.hasOwn(ROLLING_RANGE_MS, startKey)
    ? ROLLING_RANGE_MS[startKey]
    : null;
  return { live, rangeMs };
}

export interface AggregatePatchContext {
  /** The window ends now; fixed (past) windows are never patched. */
  live: boolean;
  /** Rolling span of the window, to drop the buckets that left it; null keeps them all. */
  rangeMs: number | null;
  now: number;
  /** Offset the query was made with, so new buckets start where the server's do. */
  utcOffsetMinutes: number;
}

/** Numeric values of the reading only: nulls carry nothing to aggregate. */
function numericValues(values: ReadingValues): Record<string, Record<string, number>> {
  const numeric: Record<string, Record<string, number>> = {};
  for (const [sensorKey, variables] of Object.entries(values)) {
    for (const [code, value] of Object.entries(variables)) {
      if (typeof value === "number" && Number.isFinite(value)) (numeric[sensorKey] ??= {})[code] = value;
    }
  }
  return numeric;
}

/** The bucket with the reading folded in: running average, min, max and count. */
function foldIntoBucket(item: AggregateItem, values: Record<string, Record<string, number>>): AggregateItem {
  const merged: AggregateItem["values"] = { ...item.values };
  for (const [sensorKey, variables] of Object.entries(values)) {
    const sensor = { ...merged[sensorKey] };
    for (const [code, value] of Object.entries(variables)) {
      const stat = sensor[code];
      sensor[code] = stat
        ? {
          avg: (stat.avg * stat.count + value) / (stat.count + 1),
          min: Math.min(stat.min, value),
          max: Math.max(stat.max, value),
          count: stat.count + 1,
        }
        : { avg: value, min: value, max: value, count: 1 };
    }
    merged[sensorKey] = sensor;
  }
  return { ...item, values: merged };
}

/**
 * Fold a live reading into a cached aggregate of a window that ends now: the reading
 * updates its bucket (normally the last one) or opens a new one after it.
 *
 * - Past (fixed) windows are left untouched: the reading is outside them.
 * - `end` marks the newest instant already counted (the server's window end, then each
 *   folded reading), so a reading at or before it (already aggregated by the server, or
 *   the same pulse twice) is skipped instead of counted twice.
 * - A sensor or variable the aggregate does not describe asks for a refetch.
 */
export function patchAggregate(
  data: AggregateTelemetry | undefined,
  reading: TelemetryItem,
  { live, rangeMs, now, utcOffsetMinutes }: AggregatePatchContext,
): PatchOutcome<AggregateTelemetry> {
  if (!live || !data) return UNCHANGED;
  const at = epoch(reading.time);
  if (Number.isNaN(at)) return INVALIDATE;
  const values = numericValues(reading.values);
  if (Object.keys(values).length === 0) return UNCHANGED;
  if (!describes(data, values)) return INVALIDATE;
  const counted = epoch(data.end);
  if (!Number.isNaN(counted) && at <= counted) return UNCHANGED;

  const bucketMs = data.bucketSeconds * 1000;
  const bucketStart = bucketStartOf(at, bucketMs, utcOffsetMinutes);
  const index = data.items.findIndex((item) => epoch(item.time) >= bucketStart);
  let items: AggregateItem[];
  if (index !== -1 && epoch(data.items[index].time) === bucketStart) {
    items = data.items.map((item, position) => position === index ? foldIntoBucket(item, values) : item);
  } else {
    const opened = foldIntoBucket({ time: new Date(bucketStart).toISOString(), values: {} }, values);
    const position = index === -1 ? data.items.length : index;
    items = [...data.items.slice(0, position), opened, ...data.items.slice(position)];
  }
  if (rangeMs !== null) {
    const windowStart = now - rangeMs;
    items = items.filter((item) => epoch(item.time) + bucketMs > windowStart);
  }
  return { status: "patched", page: { ...data, items, end: new Date(at).toISOString() } };
}
