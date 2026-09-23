import { describe, expect, it } from "vitest";

import { toPositiveInt } from "./url-params";

describe("toPositiveInt", () => {
  it("keeps valid positive integers", () => {
    expect(toPositiveInt("3", 1)).toBe(3);
  });

  it.each([null, "", "abc", "0", "-2", "1.5"])("falls back for %j", (value) => {
    expect(toPositiveInt(value, 10)).toBe(10);
  });

  it("clamps to max when given", () => {
    expect(toPositiveInt("20000", 10, 100)).toBe(100);
    expect(toPositiveInt("50", 10, 100)).toBe(50);
  });
});
