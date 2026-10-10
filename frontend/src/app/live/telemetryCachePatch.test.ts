import { describe, expect, it } from "vitest";

import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import {
  isReadingValues,
  latestLimit,
  patchHistoryPage,
  patchLatestPage,
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

  it("ignores duplicates, signals unknown sensors and leaves an empty cache untouched", () => {
    expect(patchLatestPage(cached, reading("2026-10-10T11:30:00Z"), 2)).toEqual({ status: "unchanged" });
    expect(patchLatestPage(page([], 0), reading(), 2)).toEqual({ status: "patched", page: expect.any(Object) });
    expect(patchLatestPage({ items: [], total: 0, sensors: [] }, reading(), 2)).toEqual({ status: "invalidate" });
    expect(patchLatestPage(undefined, reading(), 2)).toEqual({ status: "unchanged" });
  });
});
