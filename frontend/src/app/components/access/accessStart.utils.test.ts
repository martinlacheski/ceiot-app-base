import { describe, expect, it } from "vitest";
import { formatAccessStartLabel, toLocalDateTimePayload } from "./accessStart.utils";

describe("toLocalDateTimePayload", () => {
  it("sends the picked local wall clock with its UTC offset, so the API stores that instant", () => {
    const picked = new Date(2026, 4, 28, 14, 30, 0);
    const payload = toLocalDateTimePayload(picked);

    expect(payload).toMatch(/^2026-05-28T14:30:00[+-]\d\d:\d\d$/);
    expect(new Date(payload).getTime()).toBe(picked.getTime());
  });
});

describe("formatAccessStartLabel", () => {
  it("shows the stored instant in local time for the API's offset-aware form", () => {
    const picked = new Date(2026, 4, 27, 0, 0, 0);

    expect(formatAccessStartLabel(picked.toISOString())).toBe("Desde 27/05/2026 00:00");
    expect(formatAccessStartLabel(toLocalDateTimePayload(picked))).toBe("Desde 27/05/2026 00:00");
  });
});
