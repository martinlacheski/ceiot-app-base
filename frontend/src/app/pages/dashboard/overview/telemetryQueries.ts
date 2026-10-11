import { keepPreviousData } from "@tanstack/react-query";

import { localUtcOffsetMinutes } from "@/app/live/telemetryCachePatch";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { periodQueryKey, periodWindow, type AggregationLevel, type ReadingsPeriod } from "./overviewModel";

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

/** Point budget of the automatic bucket: 1h → 1 min, 24h → 5 min, 7d → 15 min, 30d → 1 h. */
export const AUTO_MAX_POINTS = 800;

/**
 * Aggregate query shared by the per-device and per-establishment views: `["telemetry",
 * "aggregate", deviceId, startKey, endKey, bucket]`. A preset is keyed by its id and "now"
 * and resolves its rolling bounds when the query runs, so the key stays stable and the live
 * pulse folds new readings into its last bucket. The previous data stays on screen while
 * another device, period or bucket loads.
 */
export function aggregateQueryOptions(
  deviceId: string | undefined,
  period: ReadingsPeriod,
  bucket: AggregationLevel,
  enabled: boolean,
  liveConnected: boolean,
) {
  return {
    queryKey: ["telemetry", "aggregate", deviceId, ...periodQueryKey(period), bucket],
    queryFn: () => {
      const now = Date.now();
      const { start, end } = periodWindow(period, now);
      return environmentalSensorService.getAggregate(deviceId!, {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        bucket,
        utcOffsetMinutes: localUtcOffsetMinutes(now),
        maxPoints: AUTO_MAX_POINTS,
      });
    },
    enabled: Boolean(deviceId) && enabled,
    placeholderData: keepPreviousData,
    ...liveRefreshOptions(liveConnected),
  };
}
