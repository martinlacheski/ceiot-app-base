import { describe, expect, it } from "vitest";
import { formatDateTime, parseApiDateTime } from "./date.utils";

describe("parseApiDateTime", () => {
  const instant = Date.UTC(2026, 9, 11, 12, 30, 0);

  it("reads the offset-aware timestamps the API returns", () => {
    expect(parseApiDateTime("2026-10-11T12:30:00Z")?.getTime()).toBe(instant);
    expect(parseApiDateTime("2026-10-11T12:30:00+00:00")?.getTime()).toBe(instant);
    expect(parseApiDateTime("2026-10-11T09:30:00-03:00")?.getTime()).toBe(instant);
    expect(parseApiDateTime("2026-10-11T12:30:00.123456Z")?.getTime()).toBe(instant + 123);
  });

  it("still treats a legacy naive timestamp as UTC", () => {
    expect(parseApiDateTime("2026-10-11T12:30:00")?.getTime()).toBe(instant);
    expect(parseApiDateTime("2026-10-11 12:30:00")?.getTime()).toBe(instant);
  });

  it("keeps a bare date as a local calendar day and rejects empty or invalid input", () => {
    expect(parseApiDateTime("2026-10-11")).toEqual(new Date(2026, 9, 11));
    expect(parseApiDateTime(null)).toBeNull();
    expect(parseApiDateTime("")).toBeNull();
    expect(parseApiDateTime("not a date")).toBeNull();
  });

  it("formats both forms of the same instant identically", () => {
    expect(formatDateTime("2026-10-11T12:30:00Z")).toBe(formatDateTime("2026-10-11T12:30:00"));
    expect(formatDateTime("2026-10-11T12:30:00+00:00")).toBe(formatDateTime("2026-10-11T12:30:00"));
  });
});
