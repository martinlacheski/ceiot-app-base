import { describe, expect, it } from "vitest";

import type { AggregateTelemetry, LiveTelemetry, TelemetryPage } from "@/app/types/environmentalSensor.types";
import {
  aggregateWindowOf,
  bucketStartOf,
  isReadingValues,
  latestLimit,
  patchHistoryPage,
  patchLatestPage,
  patchAggregate,
  patchLiveState,
  ROLLING_RANGE_MS,
  rollingRangeOf,
} from "./telemetryCachePatch";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-10T12:00:00Z");

const sensors = [
  {
    key: "dht22",
    sensorCode: "DHT22",
    sensorName: "DHT22",
    variables: [
      { code: "temperature", name: "Temperatura", unit: "°C" },
      { code: "relative_humidity", name: "Humedad", unit: "%" },
    ],
  },
];

const item = (time: string, temperature: number) => ({ time, values: { dht22: { temperature } } });

const page = (items: TelemetryPage["items"], total = items.length): TelemetryPage => ({ items, total, sensors });

const reading = (time = "2026-10-10T12:00:00+00:00", temperature = 25) => ({
  time,
  values: { dht22: { temperature, relative_humidity: null } },
});

describe("rolling ranges", () => {
  it("knows the rolling ranges used by the dashboard and the device views", () => {
    expect(ROLLING_RANGE_MS).toEqual({ "1h": HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR });
  });

  it("reads the rolling range of a plain history key only", () => {
    expect(rollingRangeOf(["telemetry", "history", "dev-1", "24h"])).toBe(24 * HOUR);
    expect(rollingRangeOf(["telemetry", "history", "dev-1", "custom", "a", "b"])).toBeNull();
    expect(rollingRangeOf(["telemetry", "history", "dev-1", "2y"])).toBeNull();
    expect(rollingRangeOf(["telemetry", "history", "dev-1"])).toBeNull();
  });

  it("reads the numeric limit of a latest key, defaulting to one", () => {
    expect(latestLimit(["telemetry", "latest", "dev-1", 10])).toBe(10);
    expect(latestLimit(["telemetry", "latest", "dev-1"])).toBe(1);
    expect(latestLimit(["telemetry", "latest", "dev-1", "x"])).toBe(1);
  });
});

describe("isReadingValues", () => {
  it("accepts sensor → variable maps only", () => {
    expect(isReadingValues({ dht22: { temperature: 21.5, relative_humidity: null } })).toBe(true);
    expect(isReadingValues(null)).toBe(false);
    expect(isReadingValues(undefined)).toBe(false);
    expect(isReadingValues({})).toBe(false);
    expect(isReadingValues(["dht22"])).toBe(false);
    expect(isReadingValues({ dht22: 21.5 })).toBe(false);
    expect(isReadingValues({ dht22: { temperature: "hot" } })).toBe(false);
  });
});

describe("patchHistoryPage", () => {
  const cached = page([item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)]);

  it("prepends the reading newest first and bumps the total", () => {
    const outcome = patchHistoryPage(cached, reading(), 24 * HOUR, NOW);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items.map((entry) => entry.time)).toEqual([
      "2026-10-10T12:00:00+00:00",
      "2026-10-10T11:30:00Z",
      "2026-10-10T11:00:00Z",
    ]);
    expect(outcome.page.items[0].values).toEqual({ dht22: { temperature: 25, relative_humidity: null } });
    expect(outcome.page.total).toBe(3);
    expect(outcome.page.sensors).toBe(cached.sensors);
  });

  it("ignores a reading already in the cache, even with another time format", () => {
    expect(patchHistoryPage(cached, reading("2026-10-10T11:30:00+00:00"), 24 * HOUR, NOW)).toEqual({ status: "unchanged" });
  });

  it("keeps the newest-first order for an out-of-order reading", () => {
    const outcome = patchHistoryPage(cached, reading("2026-10-10T11:15:00Z"), 24 * HOUR, NOW);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items.map((entry) => entry.time)).toEqual([
      "2026-10-10T11:30:00Z",
      "2026-10-10T11:15:00Z",
      "2026-10-10T11:00:00Z",
    ]);
  });

  it("drops the readings that left the rolling window", () => {
    const outcome = patchHistoryPage(cached, reading(), HOUR / 2 + 60_000, NOW);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00+00:00", "2026-10-10T11:30:00Z"]);
    expect(outcome.page.total).toBe(2);
  });

  it("keeps a truncated page at its loaded size", () => {
    const truncated = page([item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)], 50);

    const outcome = patchHistoryPage(truncated, reading(), 24 * HOUR, NOW);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00+00:00", "2026-10-10T11:30:00Z"]);
    expect(outcome.page.total).toBe(51);
  });

  it("asks for a refetch when a sensor or variable is not described by the cached page", () => {
    expect(patchHistoryPage(cached, { time: reading().time, values: { bme280: { pressure: 1013 } } }, 24 * HOUR, NOW))
      .toEqual({ status: "invalidate" });
    expect(patchHistoryPage(cached, { time: reading().time, values: { dht22: { co2: 400 } } }, 24 * HOUR, NOW))
      .toEqual({ status: "invalidate" });
  });

  it("asks for a refetch when the range is not a rolling window", () => {
    expect(patchHistoryPage(cached, reading(), null, NOW)).toEqual({ status: "invalidate" });
  });

  it("leaves an empty cache untouched", () => {
    expect(patchHistoryPage(undefined, reading(), 24 * HOUR, NOW)).toEqual({ status: "unchanged" });
  });

  it("asks for a refetch when the reading time is unreadable", () => {
    expect(patchHistoryPage(cached, reading("not a date"), 24 * HOUR, NOW)).toEqual({ status: "invalidate" });
  });
});

describe("patchHistoryPage counters", () => {
  const loaded = [item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)];
  const paginated = (total: number): TelemetryPage => ({ ...page(loaded, total), page: 1, perPage: 2, pages: Math.ceil(total / 2) });
  const patched = (outcome: ReturnType<typeof patchHistoryPage>) => {
    expect(outcome.status).toBe("patched");
    return (outcome as { page: TelemetryPage }).page;
  };

  it("keeps a paginated page at its page size and recomputes the page count", () => {
    const result = patched(patchHistoryPage(paginated(2), reading(), 24 * HOUR, NOW));

    expect(result.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00+00:00", "2026-10-10T11:30:00Z"]);
    expect(result.total).toBe(3);
    expect(result.pages).toBe(2);
    expect(result.perPage).toBe(2);
  });

  it("counts an older reading sliced off a complete page, since it cannot repeat an unloaded row", () => {
    const result = patched(patchHistoryPage(paginated(2), reading("2026-10-10T10:30:00Z"), 24 * HOUR, NOW));

    expect(result.items).toEqual(loaded);
    expect(result.total).toBe(3);
    expect(result.pages).toBe(2);
  });

  it("does not count an out-of-order reading that falls past the loaded rows of a truncated page", () => {
    expect(patchHistoryPage(page(loaded, 50), reading("2026-10-10T10:00:00Z"), 24 * HOUR, NOW))
      .toEqual({ status: "unchanged" });
    expect(patchHistoryPage(paginated(50), reading("2026-10-10T10:00:00Z"), 24 * HOUR, NOW))
      .toEqual({ status: "unchanged" });
  });

  it("drops the unloaded rows too once a loaded row leaves the window of a truncated page", () => {
    // The unloaded rows are older than every loaded one, so they left the window first.
    const result = patched(patchHistoryPage(paginated(50), reading(), HOUR / 2 + 60_000, NOW));

    expect(result.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00+00:00", "2026-10-10T11:30:00Z"]);
    expect(result.total).toBe(2);
    expect(result.pages).toBe(1);
  });

  it("only subtracts the rows that left the window when the reading itself is too old", () => {
    const result = patched(patchHistoryPage(page(loaded), reading("2026-10-10T10:00:00Z"), HOUR / 2 + 60_000, NOW));

    expect(result.items.map((entry) => entry.time)).toEqual(["2026-10-10T11:30:00Z"]);
    expect(result.total).toBe(1);
  });

  it("leaves the page alone when only the reading falls outside the window", () => {
    expect(patchHistoryPage(page(loaded), reading("2026-10-09T10:00:00Z"), 24 * HOUR, NOW)).toEqual({ status: "unchanged" });
  });
});

describe("patchLatestPage", () => {
  const cached = page([item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)], 2);

  it("prepends and slices to the limit", () => {
    const outcome = patchLatestPage(cached, reading(), 2);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00+00:00", "2026-10-10T11:30:00Z"]);
    expect(outcome.page.total).toBe(3);
  });

  it("keeps only the newest reading for the default limit", () => {
    const outcome = patchLatestPage(cached, reading(), 1);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.items).toHaveLength(1);
    expect(outcome.page.items[0].time).toBe("2026-10-10T12:00:00+00:00");
  });

  it("does not count an out-of-order reading sliced off a full page", () => {
    const full = page([item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)], 40);

    expect(patchLatestPage(full, reading("2026-10-10T10:00:00Z"), 2)).toEqual({ status: "unchanged" });
  });

  it("counts a newer reading on a full page", () => {
    const full = page([item("2026-10-10T11:30:00Z", 23), item("2026-10-10T11:00:00Z", 22)], 40);
    const outcome = patchLatestPage(full, reading(), 2);

    expect(outcome.status).toBe("patched");
    if (outcome.status !== "patched") return;
    expect(outcome.page.total).toBe(41);
  });

  it("ignores duplicates, signals unknown sensors and leaves an empty cache untouched", () => {
    expect(patchLatestPage(cached, reading("2026-10-10T11:30:00Z"), 2)).toEqual({ status: "unchanged" });
    expect(patchLatestPage(page([], 0), reading(), 2)).toEqual({ status: "patched", page: expect.any(Object) });
    expect(patchLatestPage({ items: [], total: 0, sensors: [] }, reading(), 2)).toEqual({ status: "invalidate" });
    expect(patchLatestPage(undefined, reading(), 2)).toEqual({ status: "unchanged" });
  });
});

describe("patchLiveState", () => {
  const bmp = { key: "bmp280", sensorCode: "BMP280", sensorName: "BMP280",
    variables: [{ code: "pressure", name: "Presión", unit: "hPa" }] };
  const live = (overrides: Partial<LiveTelemetry> = {}): LiveTelemetry => ({
    source: "redis",
    time: "2026-10-10T11:59:00Z",
    values: { dht22: { temperature: 20, relative_humidity: 50 }, bmp280: { pressure: 1000 } },
    health: { wifi_rssi: -60 },
    presence: "online",
    sensors: [...sensors, bmp],
    ...overrides,
  });

  it("moves the time forward and merges the reading into the known values", () => {
    const outcome = patchLiveState(live(), { time: "2026-10-10T12:00:00Z", values: { dht22: { temperature: 25 } } });

    expect(outcome).toEqual({
      status: "patched",
      page: live({
        time: "2026-10-10T12:00:00Z",
        values: { dht22: { temperature: 25, relative_humidity: 50 }, bmp280: { pressure: 1000 } },
      }),
    });
  });

  it("starts from an empty state that had no reading yet", () => {
    const outcome = patchLiveState(live({ time: null, values: {}, source: "database" }), reading());

    expect(outcome.status).toBe("patched");
    expect(outcome.status === "patched" && outcome.page.values).toEqual(reading().values);
  });

  it("ignores readings that are not newer than the cached state", () => {
    expect(patchLiveState(live(), { time: "2026-10-10T11:59:00+00:00", values: { dht22: { temperature: 1 } } }))
      .toEqual({ status: "unchanged" });
    expect(patchLiveState(live(), { time: "2026-10-10T11:00:00Z", values: { dht22: { temperature: 1 } } }))
      .toEqual({ status: "unchanged" });
  });

  it("does nothing without a cached state", () => {
    expect(patchLiveState(undefined, reading())).toEqual({ status: "unchanged" });
  });

  it("refetches when the reading has an unknown sensor or variable, or an unreadable time", () => {
    expect(patchLiveState(live(), { time: "2026-10-10T12:00:00Z", values: { bme680: { gas: 3 } } }))
      .toEqual({ status: "invalidate" });
    expect(patchLiveState(live(), { time: "2026-10-10T12:00:00Z", values: { dht22: { dew_point: 3 } } }))
      .toEqual({ status: "invalidate" });
    expect(patchLiveState(live(), { time: "not a time", values: { dht22: { temperature: 3 } } }))
      .toEqual({ status: "invalidate" });
  });
});

describe("aggregate buckets", () => {
  const MINUTE = 60 * 1000;

  it("aligns buckets on the local midnight of the requested UTC offset", () => {
    expect(bucketStartOf(Date.parse("2026-10-10T12:07:30Z"), 5 * MINUTE, 0)).toBe(Date.parse("2026-10-10T12:05:00Z"));
    // UTC-3: a daily bucket starts at 03:00 UTC.
    expect(bucketStartOf(Date.parse("2026-10-10T02:59:00Z"), 24 * HOUR, -180)).toBe(Date.parse("2026-10-09T03:00:00Z"));
    expect(bucketStartOf(Date.parse("2026-10-10T03:00:00Z"), 24 * HOUR, -180)).toBe(Date.parse("2026-10-10T03:00:00Z"));
    // UTC+5:30: a 1h bucket starts at the half hour in UTC.
    expect(bucketStartOf(Date.parse("2026-10-10T12:10:00Z"), HOUR, 330)).toBe(Date.parse("2026-10-10T11:30:00Z"));
  });

  it("reads whether an aggregate key follows the live window and its rolling span", () => {
    expect(aggregateWindowOf(["telemetry", "aggregate", "dev-1", "24h", "now", "auto"])).toEqual({ live: true, rangeMs: 24 * HOUR });
    expect(aggregateWindowOf(["telemetry", "aggregate", "dev-1", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", "1h"]))
      .toEqual({ live: false, rangeMs: null });
  });
});

describe("patchAggregate", () => {
  const stat = (avg: number, min: number, max: number, count: number) => ({ avg, min, max, count });
  const aggregate = (overrides: Partial<AggregateTelemetry> = {}): AggregateTelemetry => ({
    bucket: "5m",
    bucketSeconds: 300,
    start: "2026-10-10T11:03:00Z",
    end: "2026-10-10T12:03:00Z",
    items: [
      { time: "2026-10-10T11:55:00Z", values: { dht22: { temperature: stat(18, 18, 18, 1) } } },
      { time: "2026-10-10T12:00:00Z", values: { dht22: { temperature: stat(20, 19, 21, 2) } } },
    ],
    sensors,
    ...overrides,
  });
  const live = { live: true, rangeMs: HOUR, now: Date.parse("2026-10-10T12:04:00Z"), utcOffsetMinutes: 0 };
  const patched = (outcome: ReturnType<typeof patchAggregate>) => {
    if (outcome.status !== "patched") throw new Error(`expected a patch, got ${outcome.status}`);
    return outcome.page;
  };

  it("folds a reading into the last bucket: running average, min, max and count", () => {
    const page = patched(patchAggregate(aggregate(), reading("2026-10-10T12:04:00Z", 23), live));

    expect(page.items).toHaveLength(2);
    expect(page.items[1].values.dht22.temperature).toEqual(stat(21, 19, 23, 3));
    expect(page.items[0]).toEqual(aggregate().items[0]);
    // The reading is counted: the same pulse delivered twice is not folded again.
    expect(page.end).toBe("2026-10-10T12:04:00.000Z");
    expect(patchAggregate(page, reading("2026-10-10T12:04:00Z", 23), live)).toEqual({ status: "unchanged" });
  });

  it("starts the statistics of a variable the bucket did not have yet, ignoring nulls", () => {
    const humid = { time: "2026-10-10T12:04:00Z", values: { dht22: { temperature: null, relative_humidity: 50 } } };
    const page = patched(patchAggregate(aggregate(), humid, live));

    expect(page.items[1].values.dht22).toEqual({ temperature: stat(20, 19, 21, 2), relative_humidity: stat(50, 50, 50, 1) });
  });

  it("appends a new bucket when the reading falls after the last bucket end", () => {
    const page = patched(patchAggregate(aggregate(), reading("2026-10-10T12:06:10Z", 25), { ...live, now: Date.parse("2026-10-10T12:06:10Z") }));

    expect(page.items.map((entry) => entry.time)).toEqual([
      "2026-10-10T11:55:00Z", "2026-10-10T12:00:00Z", "2026-10-10T12:05:00.000Z",
    ]);
    expect(page.items[2].values).toEqual({ dht22: { temperature: stat(25, 25, 25, 1) } });
  });

  it("uses the bucket size of the response, also for an automatic bucket", () => {
    const hourly = aggregate({ bucket: "1h", bucketSeconds: 3600, items: [
      { time: "2026-10-10T12:00:00Z", values: { dht22: { temperature: stat(20, 20, 20, 1) } } },
    ] });
    const page = patched(patchAggregate(hourly, reading("2026-10-10T12:50:00Z", 22), { ...live, rangeMs: 24 * HOUR }));

    expect(page.items).toHaveLength(1);
    expect(page.items[0].values.dht22.temperature).toEqual(stat(21, 20, 22, 2));
  });

  it("drops the buckets that left the rolling window", () => {
    const now = Date.parse("2026-10-10T13:01:00Z");
    const page = patched(patchAggregate(aggregate(), reading("2026-10-10T13:01:00Z", 22), { ...live, now }));

    // 11:55 ended at 12:00, before the 12:01 window start; 12:00 ends at 12:05, still inside.
    expect(page.items.map((entry) => entry.time)).toEqual(["2026-10-10T12:00:00Z", "2026-10-10T13:00:00.000Z"]);
  });

  it("leaves a past (fixed) window untouched", () => {
    expect(patchAggregate(aggregate(), reading("2026-10-10T12:04:00Z"), { ...live, live: false, rangeMs: null }))
      .toEqual({ status: "unchanged" });
  });

  it("skips a reading the server already counted", () => {
    expect(patchAggregate(aggregate(), reading("2026-10-10T12:02:00Z"), live)).toEqual({ status: "unchanged" });
  });

  it("asks for a refetch when a sensor or variable is not described by the cached aggregate", () => {
    expect(patchAggregate(aggregate(), { time: "2026-10-10T12:04:00Z", values: { bme280: { pressure: 1013 } } }, live))
      .toEqual({ status: "invalidate" });
    expect(patchAggregate(aggregate({ items: [], sensors: [] }), reading("2026-10-10T12:04:00Z"), live))
      .toEqual({ status: "invalidate" });
  });

  it("asks for a refetch when the reading time is unreadable and ignores an empty cache", () => {
    expect(patchAggregate(aggregate(), reading("not a time"), live)).toEqual({ status: "invalidate" });
    expect(patchAggregate(undefined, reading("2026-10-10T12:04:00Z"), live)).toEqual({ status: "unchanged" });
  });

  it("ignores a reading without numeric values", () => {
    const empty = { time: "2026-10-10T12:04:00Z", values: { dht22: { temperature: null } } };
    expect(patchAggregate(aggregate(), empty, live)).toEqual({ status: "unchanged" });
  });
});
