import { useCallback, useSyncExternalStore } from "react";

const canMatchMedia = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

/** Tracks a media query, defaulting to false when matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatchMedia()) return () => undefined;
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = () =>
    canMatchMedia() ? window.matchMedia(query).matches : false;

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
