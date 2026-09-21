import { describe, expect, it } from "vitest";

import {
  COUNTRY_SORT_OPTIONS,
  parseLocationSort,
  serializeLocationSort,
} from "../locationSort";

describe("locationSort", () => {
  it.each([
    ["name:asc", { field: "name", direction: "asc" }],
    ["isActive:desc", { field: "isActive", direction: "desc" }],
  ] as const)("parses the canonical country sort %s", (raw, sort) => {
    expect(parseLocationSort(raw, COUNTRY_SORT_OPTIONS)).toEqual({
      sort,
      isValid: true,
    });
    expect(serializeLocationSort(sort)).toBe(raw);
  });

  it.each([
    "name",
    "unknown:asc",
    "name:up",
    "name:asc:extra",
    "name:asc,isActive:desc",
    "name:asc,name:desc",
  ])("rejects invalid single-sort input %s", (raw) => {
    expect(parseLocationSort(raw, COUNTRY_SORT_OPTIONS)).toEqual({
      sort: undefined,
      isValid: false,
    });
  });

  it("treats an absent sort as a valid implicit default", () => {
    expect(parseLocationSort(null, COUNTRY_SORT_OPTIONS)).toEqual({
      sort: undefined,
      isValid: true,
    });
    expect(serializeLocationSort(undefined)).toBeUndefined();
  });
});
