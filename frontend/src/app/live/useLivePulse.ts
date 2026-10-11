import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { appApi } from "@/api/appApi";
import type { LiveTelemetry, TelemetryPage } from "@/app/types/environmentalSensor.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { API_BASE_URL } from "@/lib/apiBaseUrl";
import { useMountEffect } from "../hooks/useMountEffect";
import { useLivePulseStatus } from "./livePulse.store";
import { createPulseClient, type PulseEvent } from "./pulseClient";
import {
  isReadingValues,
  latestLimit,
  patchHistoryPage,
  patchLatestPage,
  patchLiveState,
  rollingRangeOf,
  type PatchOutcome,
  type ReadingValues,
} from "./telemetryCachePatch";

/** A burst of pulses (several devices, several messages) collapses into one refetch round. */
const FLUSH_DELAY_MS = 300;

/** Query keys whose data changes when this device pulses. */
export function queryKeysForPulse(event: PulseEvent): QueryKey[] {
  const id = event.deviceId;
  const keys: QueryKey[] = [
    ["devices", "list"],
    ["devices", "map"],
    ["devices", "operational-overview"],
    ["devices", "detail", id],
    ["device", "detail", id],
    ["environments", "operational-overview"],
  ];
  if (event.kind === "telemetry") {
    keys.push(
      ["telemetry", "latest", id],
      ["telemetry", "live", id],
      ["telemetry", "history", id],
      ["telemetry", "daily", id],
      ["telemetry", "detailed", id],
    );
  }
  return keys;
}

/**
 * Queries a reading-carrying telemetry pulse still refreshes: server-side
 * aggregates, the device's own detail and the device lists (the same report
 * persists last connection, rssi and GPS on the device row). The history, latest
 * and live caches are not here: `applyReading` patches them in place.
 */
function queryKeysAfterReading(deviceId: string): QueryKey[] {
  return [
    ["devices", "list"],
    ["devices", "map"],
    ["devices", "operational-overview"],
    ["devices", "detail", deviceId],
    ["device", "detail", deviceId],
    ["telemetry", "daily", deviceId],
    ["telemetry", "detailed", deviceId],
  ];
}

/**
 * Fold the reading into every cached history/latest page and the live state of
 * the device, and return the keys that could not be patched and must be refetched instead.
 */
export function applyReading(queryClient: QueryClient, deviceId: string, time: string, values: ReadingValues): QueryKey[] {
  const reading = { time, values };
  const now = Date.now();
  const refetch: QueryKey[] = [];
  const patchAll = <T>(prefix: QueryKey, patch: (key: QueryKey, data: T | undefined) => PatchOutcome<T>) => {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
      const key = query.queryKey;
      // A response already in flight may predate the reading and would overwrite the patch.
      if (query.state.fetchStatus === "fetching") {
        refetch.push(key);
        continue;
      }
      const outcome = patch(key, query.state.data as T | undefined);
      if (outcome.status === "patched") queryClient.setQueryData(key, outcome.page);
      else if (outcome.status === "invalidate") refetch.push(key);
    }
  };
  patchAll<TelemetryPage>(["telemetry", "history", deviceId], (key, page) => patchHistoryPage(page, reading, rollingRangeOf(key), now));
  patchAll<TelemetryPage>(["telemetry", "latest", deviceId], (key, page) => patchLatestPage(page, reading, latestLimit(key)));
  patchAll<LiveTelemetry>(["telemetry", "live", deviceId], (_key, live) => patchLiveState(live, reading));
  return refetch;
}

const keyId = (key: QueryKey) => JSON.stringify(key);

function createInvalidator(queryClient: QueryClient) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  };

  return {
    add(keys: QueryKey[]) {
      for (const key of keys) pending.set(keyId(key), key);
      if (timer === null) timer = setTimeout(flush, FLUSH_DELAY_MS);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await appApi.post("/auth/refresh");
    useAuthStore.getState().loginWithToken(data.access_token);
    return data.access_token as string;
  } catch {
    return null;
  }
}

/**
 * Keeps the live pulse connection open for the authenticated app and refreshes
 * only the queries of the devices that reported something. A telemetry pulse
 * that carries its reading is appended to the cached pages without a refetch,
 * so charts move in place. Mount it once, in the authenticated layout.
 */
export function useLivePulse() {
  const queryClient = useQueryClient();

  useMountEffect(() => {
    const invalidator = createInvalidator(queryClient);
    const client = createPulseClient({
      baseUrl: API_BASE_URL,
      getToken: () => useAuthStore.getState().token,
      refreshToken: refreshAccessToken,
      onPulse: (event) => {
        if (event.kind === "telemetry" && isReadingValues(event.values)) {
          const refetch = applyReading(queryClient, event.deviceId, event.time, event.values);
          invalidator.add([...refetch, ...queryKeysAfterReading(event.deviceId)]);
        } else {
          invalidator.add(queryKeysForPulse(event));
        }
      },
      onResync: () =>
        invalidator.add([["devices"], ["device"], ["telemetry"], ["environments", "operational-overview"]]),
      onStatusChange: (connected) => useLivePulseStatus.getState().setConnected(connected),
    });
    client.start();
    return () => {
      client.stop();
      invalidator.cancel();
      useLivePulseStatus.getState().setConnected(false);
    };
  });
}
