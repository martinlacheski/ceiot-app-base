import { describe, expect, it } from "vitest";
import { formatHistoryBoolean, formatHistoryReading } from "./readingFormat";

describe("history reading formatting", () => {
  it("renders nullable booleans without treating false as missing", () => {
    expect(formatHistoryBoolean(false)).toBe("No");
    expect(formatHistoryBoolean(true)).toBe("Sí");
    expect(formatHistoryBoolean(null)).toBe("-");
  });
  it("renders environmental units and missing values", () => {
    expect(formatHistoryReading(22.5, "°C")).toBe("22,5 °C");
    expect(formatHistoryReading(null, "%")).toBe("-");
  });
});
