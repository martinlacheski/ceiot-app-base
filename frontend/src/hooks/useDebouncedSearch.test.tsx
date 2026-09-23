import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedSearch } from "./useDebouncedSearch";

describe("useDebouncedSearch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with the initial value in both value and debounced", () => {
    const { result } = renderHook(() => useDebouncedSearch("abc"));
    expect(result.current.value).toBe("abc");
    expect(result.current.debounced).toBe("abc");
  });

  it("updates value immediately and debounced after 300 ms by default", () => {
    const { result } = renderHook(() => useDebouncedSearch());
    act(() => result.current.setValue("pool"));
    expect(result.current.value).toBe("pool");
    expect(result.current.debounced).toBe("");
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.debounced).toBe("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.debounced).toBe("pool");
  });

  it("honors a custom delay", () => {
    const { result } = renderHook(() => useDebouncedSearch("", 50));
    act(() => result.current.setValue("x"));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.debounced).toBe("x");
  });

  it("clear resets the value", () => {
    const { result } = renderHook(() => useDebouncedSearch("abc", 10));
    act(() => result.current.clear());
    expect(result.current.value).toBe("");
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.debounced).toBe("");
  });
});
