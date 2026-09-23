import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

describe("useMediaQuery", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

  it("defaults to false when matchMedia is unavailable", () => {
    Reflect.deleteProperty(window, "matchMedia");
    expect(renderHook(() => useMediaQuery("(max-width: 767px)")).result.current).toBe(false);
  });

  it("tracks changes and removes its listener on unmount", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return matches; },
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      })),
    });
    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);
    expect(listeners.size).toBe(1);
    act(() => { matches = true; listeners.forEach((listener) => listener()); });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
