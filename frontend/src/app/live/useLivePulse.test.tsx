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
