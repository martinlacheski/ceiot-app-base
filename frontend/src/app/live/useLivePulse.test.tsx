import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PulseClientOptions, PulseEvent } from "./pulseClient";

const created: { options: PulseClientOptions; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

vi.mock("./pulseClient", () => ({
  createPulseClient: (options: PulseClientOptions) => {
    const entry = { options, start: vi.fn(), stop: vi.fn() };
    created.push(entry);
    return entry;
  },
}));

const authState = { token: "tok" as string | null, loginWithToken: vi.fn() };
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: Object.assign(() => authState, { getState: () => authState }),
}));

const post = vi.fn();
vi.mock("@/api/appApi", () => ({ appApi: { post: (...args: unknown[]) => post(...args) } }));

import { queryKeysForPulse, useLivePulse } from "./useLivePulse";
import { useLivePulseStatus } from "./livePulse.store";

const event = (overrides: Partial<PulseEvent> = {}): PulseEvent => ({
  deviceId: "dev-1",
  serial: "IOT-1",
  environmentId: "env-1",
  kind: "telemetry",
  time: "2026-05-01T12:00:00+00:00",
  ...overrides,
});

describe("queryKeysForPulse", () => {
  it("invalidates telemetry, detail, list, map and overview keys for a telemetry pulse", () => {
    const keys = queryKeysForPulse(event());
    expect(keys).toEqual(
      expect.arrayContaining([
        ["devices", "list"],
        ["devices", "map"],
        ["devices", "operational-overview"],
        ["devices", "detail", "dev-1"],
        ["device", "detail", "dev-1"],
        ["telemetry", "latest", "dev-1"],
        ["telemetry", "history", "dev-1"],
        ["telemetry", "daily", "dev-1"],
        ["telemetry", "detailed", "dev-1"],
        ["environments", "operational-overview"],
      ]),
    );
  });

  it("only refreshes device state (not telemetry) for a presence pulse", () => {
    const keys = queryKeysForPulse(event({ kind: "presence" }));
    expect(keys).toEqual(
      expect.arrayContaining([
        ["devices", "list"],
        ["device", "detail", "dev-1"],
      ]),
    );
    expect(keys.some((key) => key[0] === "telemetry")).toBe(false);
  });
});

describe("useLivePulse", () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;
  const invalidatedKeys = () =>
    (invalidate.mock.calls as unknown as [{ queryKey: string[] }][]).map(([filters]) => filters.queryKey);

  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers();
    created.length = 0;
    authState.token = "tok";
    post.mockReset();
    authState.loginWithToken.mockReset();
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts one client on mount and stops it on unmount", () => {
    const { unmount } = renderHook(() => useLivePulse(), { wrapper });
    expect(created).toHaveLength(1);
    expect(created[0].start).toHaveBeenCalledTimes(1);
    unmount();
    expect(created[0].stop).toHaveBeenCalledTimes(1);
  });

  it("invalidates the keys of the pulsed device, batching a burst into one flush", () => {
    renderHook(() => useLivePulse(), { wrapper });
    const { onPulse } = created[0].options;

    act(() => {
      onPulse(event());
      onPulse(event({ kind: "presence" }));
      onPulse(event({ deviceId: "dev-2" }));
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["telemetry", "latest", "dev-1"]);
    expect(keys).toContainEqual(["telemetry", "latest", "dev-2"]);
    // Shared keys are invalidated once, not once per pulse.
    expect(keys.filter((key) => key.join("/") === "devices/list")).toHaveLength(1);
  });

  describe("telemetry pulses carrying the reading", () => {
    const sensors = [{
      key: "dht22",
      sensorCode: "DHT22",
      sensorName: "DHT22",
      variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }],
    }];
    const cachedPage = () => ({
      items: [{ time: "2026-05-01T11:59:00+00:00", values: { dht22: { temperature: 20 } } }],
      total: 1,
      sensors,
    });
    const withValues = (overrides: Partial<PulseEvent> = {}) =>
      event({ values: { dht22: { temperature: 21.5 } }, ...overrides });
    const historyKey = ["telemetry", "history", "dev-1", "24h"];
    const latestKey = ["telemetry", "latest", "dev-1", 10];
    const singleLatestKey = ["telemetry", "latest", "dev-1"];
    const times = (key: unknown[]) =>
      (queryClient.getQueryData(key) as { items: { time: string }[] }).items.map((entry) => entry.time);

    beforeEach(() => {
      vi.setSystemTime(new Date("2026-05-01T12:00:30Z"));
      queryClient.setQueryData(historyKey, cachedPage());
      queryClient.setQueryData(latestKey, cachedPage());
      queryClient.setQueryData(singleLatestKey, cachedPage());
    });

    const pulse = (pulseEvent: PulseEvent) => {
      renderHook(() => useLivePulse(), { wrapper });
      act(() => created[0].options.onPulse(pulseEvent));
      act(() => {
        vi.advanceTimersByTime(500);
      });
    };

    it("appends the reading to the cached history and latest pages instead of refetching them", () => {
      pulse(withValues());

      expect(times(historyKey)).toEqual(["2026-05-01T12:00:00+00:00", "2026-05-01T11:59:00+00:00"]);
      expect(times(latestKey)).toEqual(["2026-05-01T12:00:00+00:00", "2026-05-01T11:59:00+00:00"]);
      expect(times(singleLatestKey)).toEqual(["2026-05-01T12:00:00+00:00"]);
      const keys = invalidatedKeys();
      expect(keys.some((key) => key[0] === "telemetry" && (key[1] === "history" || key[1] === "latest"))).toBe(false);
    });

    it("does not refetch the device and establishment lists for a reading", () => {
      pulse(withValues());

      const keys = invalidatedKeys();
      for (const listKey of [
        ["devices", "list"],
        ["devices", "map"],
        ["devices", "operational-overview"],
        ["environments", "operational-overview"],
      ]) {
        expect(keys).not.toContainEqual(listKey);
      }
      // Aggregates are still recomputed on demand by the server.
      expect(keys).toContainEqual(["telemetry", "daily", "dev-1"]);
      expect(keys).toContainEqual(["telemetry", "detailed", "dev-1"]);
    });

    it("keeps refetching everything for a telemetry pulse without values", () => {
      pulse(event());

      const keys = invalidatedKeys();
      expect(keys).toContainEqual(["telemetry", "history", "dev-1"]);
      expect(keys).toContainEqual(["telemetry", "latest", "dev-1"]);
      expect(keys).toContainEqual(["devices", "operational-overview"]);
      expect(times(historyKey)).toEqual(["2026-05-01T11:59:00+00:00"]);
    });

    it("refetches a cached page that does not describe the reading's sensor", () => {
      pulse(withValues({ values: { bme280: { pressure: 1013 } } }));

      const keys = invalidatedKeys();
      expect(keys).toContainEqual(historyKey);
      expect(keys).toContainEqual(latestKey);
      expect(times(historyKey)).toEqual(["2026-05-01T11:59:00+00:00"]);
    });

    it("refetches a history with a custom period instead of patching it", () => {
      const customKey = ["telemetry", "history", "dev-1", "custom", "Fri May 01 2026", "Fri May 01 2026"];
      queryClient.setQueryData(customKey, cachedPage());

      pulse(withValues());

      expect(invalidatedKeys()).toContainEqual(customKey);
      expect(times(customKey)).toEqual(["2026-05-01T11:59:00+00:00"]);
      expect(times(historyKey)).toEqual(["2026-05-01T12:00:00+00:00", "2026-05-01T11:59:00+00:00"]);
    });

    it("refetches a page whose response is still in flight, since it may predate the reading", () => {
      void queryClient.prefetchQuery({ queryKey: historyKey, queryFn: () => new Promise(() => {}) });

      pulse(withValues());

      expect(invalidatedKeys()).toContainEqual(historyKey);
      expect(times(latestKey)).toEqual(["2026-05-01T12:00:00+00:00", "2026-05-01T11:59:00+00:00"]);
    });

    it("leaves other devices' caches alone", () => {
      pulse(withValues({ deviceId: "dev-2" }));

      expect(times(historyKey)).toEqual(["2026-05-01T11:59:00+00:00"]);
    });
  });

  it("resyncs broadly after a reconnection", () => {
    renderHook(() => useLivePulse(), { wrapper });
    act(() => created[0].options.onResync?.());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const keys = invalidatedKeys();
    expect(keys).toEqual(expect.arrayContaining([["devices"], ["device"], ["telemetry"]]));
  });

  it("feeds the connection status to the shared indicator store", () => {
    renderHook(() => useLivePulse(), { wrapper });
    const status = renderHook(() => useLivePulseStatus((s) => s.connected));
    expect(status.result.current).toBe(false);
    act(() => created[0].options.onStatusChange?.(true));
    expect(status.result.current).toBe(true);
    act(() => created[0].options.onStatusChange?.(false));
    expect(status.result.current).toBe(false);
  });

  it("reads the current token and refreshes it through the auth endpoint", async () => {
    renderHook(() => useLivePulse(), { wrapper });
    const { getToken, refreshToken } = created[0].options;
    expect(getToken()).toBe("tok");

    post.mockResolvedValueOnce({ data: { access_token: "new" } });
    await expect(refreshToken()).resolves.toBe("new");
    expect(authState.loginWithToken).toHaveBeenCalledWith("new");

    post.mockRejectedValueOnce(new Error("expired"));
    await expect(refreshToken()).resolves.toBeNull();
  });
});
