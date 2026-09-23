import { describe, expect, it } from "vitest";
import { filterHistoryDateRange } from "./historyTabState";

describe("history date range", () => {
  it("uses inclusive local calendar dates and does not alter rows without a range", () => {
    const rows = [{ time: "2026-09-01T12:00:00Z" }, { time: "2026-09-02T12:00:00Z" }];
    expect(filterHistoryDateRange(rows, "2026-09-01", "2026-09-01")).toEqual([rows[0]]);
    expect(filterHistoryDateRange(rows)).toEqual(rows);
  });
});
