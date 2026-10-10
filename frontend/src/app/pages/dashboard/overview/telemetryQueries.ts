import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { resolveReadingsPeriod, type ReadingsRange } from "./overviewModel";

/** Fallback refresh; the live pulse invalidates these keys as soon as the device reports. */
export const TELEMETRY_REFETCH_MS = 30_000;

/**
 * History query shared by the per-device and per-establishment views. The key matches the device
 * detail page so both views share the cache and the live pulse prefix invalidation.
 */
export function historyQueryOptions(deviceId: string | undefined, range: ReadingsRange, enabled: boolean) {
  return {
    queryKey: ["telemetry", "history", deviceId, range],
    queryFn: () => {
      const { start, end } = resolveReadingsPeriod(range, Date.now());
      return environmentalSensorService.getHistory(deviceId!, start, end);
    },
    enabled: Boolean(deviceId) && enabled,
    refetchInterval: TELEMETRY_REFETCH_MS,
  };
}
