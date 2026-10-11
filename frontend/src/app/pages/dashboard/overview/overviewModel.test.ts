import { describe, expect, it } from "vitest";

import { readingsWindow, resolveReadingsPeriod } from "./overviewModel";

describe("resolveReadingsPeriod", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("returns a rolling window that ends now for every preset", () => {
    expect(resolveReadingsPeriod("1h", now)).toEqual({ start: "2026-10-10T11:00:00.000Z", end: "2026-10-10T12:00:00.000Z" });
    expect(resolveReadingsPeriod("24h", now).start).toBe("2026-10-09T12:00:00.000Z");
    expect(resolveReadingsPeriod("7d", now).start).toBe("2026-10-03T12:00:00.000Z");
  });
});

describe("readingsWindow", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("spans the rolling range that ends now, in epoch milliseconds", () => {
    expect(readingsWindow("1h", now)).toEqual({ start: now - 60 * 60 * 1000, end: now });
    expect(readingsWindow("7d", now)).toEqual({ start: now - 7 * 24 * 60 * 60 * 1000, end: now });
  });
});
