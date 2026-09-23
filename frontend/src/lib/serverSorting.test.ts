import { describe, expect, it } from "vitest";

import {
  applySortingUpdate,
  isSortOrder,
  toSortingState,
  type ServerSort,
} from "./serverSorting";

const ALLOWED = ["time", "amount"] as const;
const FALLBACK: ServerSort<(typeof ALLOWED)[number]> = { sortBy: "time", sortOrder: "desc" };

describe("serverSorting", () => {
  it("expresses the server sort as a TanStack sorting state", () => {
    expect(toSortingState({ sortBy: "amount", sortOrder: "asc" })).toEqual([
      { id: "amount", desc: false },
    ]);
    expect(toSortingState(FALLBACK)).toEqual([{ id: "time", desc: true }]);
  });

  it("maps a header click (updater function) to the next server sort", () => {
    const next = applySortingUpdate(
      () => [{ id: "amount", desc: false }],
      FALLBACK,
      ALLOWED,
      FALLBACK,
    );
    expect(next).toEqual({ sortBy: "amount", sortOrder: "asc" });
  });

  it("returns to the default sort on Reset (empty sorting)", () => {
    const next = applySortingUpdate([], { sortBy: "amount", sortOrder: "asc" }, ALLOWED, FALLBACK);
    expect(next).toEqual(FALLBACK);
  });

  it("ignores a column the server cannot sort by", () => {
    const next = applySortingUpdate(
      [{ id: "unsupported", desc: true }],
      { sortBy: "amount", sortOrder: "asc" },
      ALLOWED,
      FALLBACK,
    );
    expect(next).toEqual(FALLBACK);
  });

  it("validates sort orders read from the URL", () => {
    expect(isSortOrder("asc")).toBe(true);
    expect(isSortOrder("desc")).toBe(true);
    expect(isSortOrder("up")).toBe(false);
    expect(isSortOrder(null)).toBe(false);
  });
});
