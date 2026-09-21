import { useEffect } from "react";

/**
 * Runs `effect` once on mount and its returned cleanup (if any) once on
 * unmount. This is the only sanctioned direct use of `useEffect` in the
 * codebase (see the `no-use-effect` rule) — reserved for true mount-time
 * external system sync (DOM integration, third-party widgets, browser API
 * subscriptions). Components should never call `useEffect` directly.
 */
export function useMountEffect(effect: () => void | (() => void)) {
  /* eslint-disable react-hooks/exhaustive-deps, no-restricted-syntax */
  useEffect(effect, []);
}
