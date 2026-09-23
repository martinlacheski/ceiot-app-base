import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, useTheme } from "./useTheme";

type Listener = () => void;

const installMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<Listener>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) =>
      listeners.delete(listener),
  }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return {
    matchMedia,
    set: (value: boolean) => {
      matches = value;
      listeners.forEach((listener) => listener());
    },
  };
};

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("defaults to the system preference when nothing is stored", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("defaults to light when the system prefers light and nothing is stored", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("prefers the stored theme over the system preference", () => {
    installMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles the theme, applies the dark class and persists the choice", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("follows system preference changes only while nothing is explicitly stored", () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => media.set(true));
    expect(result.current.theme).toBe("dark");

    act(() => result.current.setTheme("light"));
    act(() => media.set(false));
    // An explicit choice is already stored, so the system flip is ignored.
    expect(result.current.theme).toBe("light");
  });
});
