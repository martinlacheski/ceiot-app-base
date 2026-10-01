import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { appApi } from "@/api/appApi";
import { useAuthStore } from "@/auth/store/auth.store";
import { API_BASE_URL } from "@/lib/apiBaseUrl";
import { useMountEffect } from "../hooks/useMountEffect";
import { useLivePulseStatus } from "./livePulse.store";
import { createPulseClient, type PulseEvent } from "./pulseClient";

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
      ["telemetry", "history", id],
      ["telemetry", "daily", id],
      ["telemetry", "detailed", id],
    );
  }
  return keys;
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
 * only the queries of the devices that reported something. Mount it once, in
 * the authenticated layout.
 */
export function useLivePulse() {
  const queryClient = useQueryClient();

  useMountEffect(() => {
    const invalidator = createInvalidator(queryClient);
    const client = createPulseClient({
      baseUrl: API_BASE_URL,
      getToken: () => useAuthStore.getState().token,
      refreshToken: refreshAccessToken,
      onPulse: (event) => invalidator.add(queryKeysForPulse(event)),
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
