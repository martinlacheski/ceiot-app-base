import { keepPreviousData } from "@tanstack/react-query";

import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { resolveReadingsPeriod, type ReadingsRange } from "./overviewModel";

/** Slow fallback refresh, only while the live pulse stream is down. */
export const FALLBACK_REFETCH_MS = 60_000;
/** The live pulse keeps these caches current: no refetch on remount for a few minutes. */
export const DASHBOARD_STALE_MS = 5 * 60_000;

/**
 * Refresh policy of every dashboard query. While the live pulse is connected it
 * patches or invalidates the caches itself, so there is no polling and no
 * refetch on window focus (both would only redraw the same data).
 */
export function liveRefreshOptions(liveConnected: boolean) {
  return {
    staleTime: DASHBOARD_STALE_MS,
    refetchOnWindowFocus: false,
    refetchInterval: liveConnected ? (false as const) : FALLBACK_REFETCH_MS,
  };
}

/**
 * History query shared by the per-device and per-establishment views. The key matches the device
 * detail page so both views share the cache and the live pulse patches it in place. The previous
 * data stays on screen while another device or range loads.
 */
export function historyQueryOptions(
  deviceId: string | undefined,
  range: ReadingsRange,
  enabled: boolean,
  liveConnected: boolean,
) {
  return {
    queryKey: ["telemetry", "history", deviceId, range],
    queryFn: () => {
      const { start, end } = resolveReadingsPeriod(range, Date.now());
      return environmentalSensorService.getHistory(deviceId!, start, end);
    },
    enabled: Boolean(deviceId) && enabled,
    placeholderData: keepPreviousData,
    ...liveRefreshOptions(liveConnected),
  };
}
