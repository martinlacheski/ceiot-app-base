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

import type { LiveTelemetry, TelemetryItem, TelemetryPage } from "@/app/types/environmentalSensor.types";

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
function describes(page: Pick<TelemetryPage, "sensors">, values: ReadingValues): boolean {
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
