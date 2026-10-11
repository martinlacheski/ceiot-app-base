import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOW_TICK_MS, useNow } from "./useNow";

describe("useNow", () => {
  const start = Date.parse("2026-10-10T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => vi.useRealTimers());

  it("returns the current time and advances it every tick", () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    act(() => vi.advanceTimersByTime(NOW_TICK_MS - 1));
    expect(result.current).toBe(start);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(start + NOW_TICK_MS);
  });

  it("stops ticking once unmounted", () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
