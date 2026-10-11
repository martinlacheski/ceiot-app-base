import { describe, expect, it } from "vitest";

import {
  aggregationAllowed,
  AGGREGATION_LEVELS,
  BAND_MAX_SERIES,
  canShiftForward,
  canShowBand,
  effectiveAggregation,
  isLivePeriod,
  periodQueryKey,
  periodWindow,
  presetPeriod,
  READINGS_RANGES,
  shiftPeriod,
  validateCustomRange,
  type ReadingsPeriod,
} from "./overviewModel";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-10T12:00:00Z");

describe("READINGS_RANGES", () => {
  it("offers the 1h, 24h, 7d and 30d rolling presets", () => {
    expect(READINGS_RANGES.map((range) => range.id)).toEqual(["1h", "24h", "7d", "30d"]);
    expect(READINGS_RANGES.map((range) => range.description)).toEqual([
      "Última hora", "Últimas 24 horas", "Últimos 7 días", "Últimos 30 días",
    ]);
  });
});

describe("periodWindow", () => {
  it("spans a preset as a rolling window that ends now", () => {
    expect(periodWindow(presetPeriod("1h"), now)).toEqual({ start: now - HOUR, end: now });
    expect(periodWindow(presetPeriod("30d"), now)).toEqual({ start: now - 30 * DAY, end: now });
  });

  it("keeps the fixed bounds of a custom window whatever the time", () => {
    const custom: ReadingsPeriod = { kind: "custom", start: now - 3 * DAY, end: now - DAY };
    expect(periodWindow(custom, now + DAY)).toEqual({ start: now - 3 * DAY, end: now - DAY });
  });
});

describe("periodQueryKey", () => {
  it("keys a preset by its id and 'now', so the rolling key stays stable as time passes", () => {
    expect(periodQueryKey(presetPeriod("24h"))).toEqual(["24h", "now"]);
    expect(isLivePeriod(presetPeriod("24h"))).toBe(true);
  });

  it("keys a custom window by its ISO bounds", () => {
    const custom: ReadingsPeriod = { kind: "custom", start: now - DAY, end: now };
    expect(periodQueryKey(custom)).toEqual(["2026-10-09T12:00:00.000Z", "2026-10-10T12:00:00.000Z"]);
    expect(isLivePeriod(custom)).toBe(false);
  });
});

describe("shiftPeriod", () => {
  it("moves a preset back by its span into a fixed window", () => {
    expect(shiftPeriod(presetPeriod("24h"), -1, now)).toEqual({ kind: "custom", start: now - 2 * DAY, end: now - DAY });
  });

  it("moves a fixed window forward by its span", () => {
    const custom: ReadingsPeriod = { kind: "custom", start: now - 3 * DAY, end: now - 2 * DAY };
    expect(shiftPeriod(custom, 1, now)).toEqual({ kind: "custom", start: now - 2 * DAY, end: now - DAY });
  });

  it("returns to the live preset when the next window reaches now", () => {
    const yesterday: ReadingsPeriod = { kind: "custom", start: now - 2 * DAY + MINUTE, end: now - DAY + MINUTE };
    expect(shiftPeriod(yesterday, 1, now)).toEqual(presetPeriod("24h"));
    const previousDay: ReadingsPeriod = { kind: "custom", start: now - 2 * DAY, end: now - DAY };
    expect(shiftPeriod(previousDay, 1, now)).toEqual(presetPeriod("24h"));
  });

  it("clamps a span without preset to a window that ends now", () => {
    const custom: ReadingsPeriod = { kind: "custom", start: now - 5 * HOUR, end: now - 2 * HOUR };
    expect(shiftPeriod(custom, 1, now)).toEqual({ kind: "custom", start: now - 3 * HOUR, end: now });
  });

  it("only moves forward a window that ends before now", () => {
    expect(canShiftForward(presetPeriod("1h"), now)).toBe(false);
    expect(canShiftForward({ kind: "custom", start: now - 2 * HOUR, end: now - HOUR }, now)).toBe(true);
    expect(canShiftForward({ kind: "custom", start: now - 2 * HOUR, end: now }, now)).toBe(false);
    expect(shiftPeriod(presetPeriod("1h"), 1, now)).toEqual(presetPeriod("1h"));
  });
});

describe("validateCustomRange", () => {
  const from = new Date("2026-10-01T08:00:00Z");

  it("accepts an end after the start within 366 days", () => {
    expect(validateCustomRange(from, new Date("2026-10-01T09:00:00Z"))).toBeNull();
    expect(validateCustomRange(from, new Date(from.getTime() + 366 * DAY))).toBeNull();
  });

  it("requires both bounds, an end after the start and at most 366 days", () => {
    expect(validateCustomRange(undefined, from)).toBe("Elegí la fecha desde y la fecha hasta.");
    expect(validateCustomRange(from, from)).toBe("La fecha hasta tiene que ser posterior a la fecha desde.");
    expect(validateCustomRange(from, new Date(from.getTime() + 367 * DAY))).toBe("El período no puede superar los 366 días.");
  });
});

describe("aggregation levels", () => {
  it("offers automatic and the backend buckets, finest first", () => {
    expect(AGGREGATION_LEVELS.map((level) => [level.id, level.label])).toEqual([
      ["auto", "Automático"],
      ["1m", "1 min"],
      ["5m", "5 min"],
      ["15m", "15 min"],
      ["1h", "1 h"],
      ["6h", "6 h"],
      ["1d", "1 día"],
    ]);
  });

  it("refuses the buckets that exceed the 10,080-bucket cap of the span", () => {
    expect(aggregationAllowed("1m", 7 * DAY)).toBe(true);
    expect(aggregationAllowed("1m", 7 * DAY + MINUTE)).toBe(false);
    expect(aggregationAllowed("5m", 30 * DAY)).toBe(true);
    expect(aggregationAllowed("5m", 36 * DAY)).toBe(false);
    expect(aggregationAllowed("15m", 200 * DAY)).toBe(false);
    expect(aggregationAllowed("1h", 366 * DAY)).toBe(true);
    expect(aggregationAllowed("auto", 366 * DAY)).toBe(true);
  });

  it("falls back to automatic when the chosen bucket no longer fits the span", () => {
    expect(effectiveAggregation("1m", 30 * DAY)).toBe("auto");
    expect(effectiveAggregation("1h", 30 * DAY)).toBe("1h");
  });
});

describe("canShowBand", () => {
  it("offers the min–max band with the average only, for a few visible series", () => {
    expect(BAND_MAX_SERIES).toBe(4);
    expect(canShowBand("avg", 4)).toBe(true);
    expect(canShowBand("avg", 5)).toBe(false);
    expect(canShowBand("min", 1)).toBe(false);
    expect(canShowBand("max", 1)).toBe(false);
  });
});
