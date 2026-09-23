import { describe, expect, it, vi } from "vitest";

import { fetchAllPages } from "./fetchAllPages";

const makePager = (all: number[]) =>
  vi.fn(async (page: number, perPage: number) => ({
    items: all.slice((page - 1) * perPage, page * perPage),
    total: all.length,
  }));

describe("fetchAllPages", () => {
  it("returns an empty list with a single request when there are no rows", async () => {
    const fetchPage = makePager([]);
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(1, 10000);
  });

  it("makes one request when everything fits in the first page", async () => {
    const fetchPage = makePager([1, 2, 3]);
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("loops the remaining pages, in order, when total exceeds perPage", async () => {
    const all = Array.from({ length: 25 }, (_, i) => i);
    const fetchPage = makePager(all);
    await expect(fetchAllPages(fetchPage, { perPage: 10 })).resolves.toEqual(all);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("stops when a page comes back empty even if total is inflated", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 10 })
      .mockResolvedValueOnce({ items: [], total: 10 });
    await expect(fetchAllPages(fetchPage, { perPage: 2 })).resolves.toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("propagates a failing page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], total: 2 })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(fetchAllPages(fetchPage, { perPage: 1 })).rejects.toThrow("boom");
  });
});
