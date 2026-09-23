import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPublicMapLoader } from "../src/maps/publicMapLoader";
import type { PublicLocation } from "../src/maps/publicMap";

const LIVE = "https://api.example.test/api/public/map/locations";
const STATIC = "/map-locations.json";
const INTERVAL = 5 * 60 * 1000;
const live = [{
  displayName: "Establecimiento central",
  latitude: -31.42,
  longitude: -64.19,
  city: "Córdoba",
  state: "Córdoba",
  country: "Argentina",
  activeDeviceCount: 2,
}];
const fallback = [{
  displayName: "Establecimiento de respaldo",
  latitude: -34.6,
  longitude: -58.38,
  city: "Buenos Aires",
  state: "Buenos Aires",
  country: "Argentina",
  activeDeviceCount: 1,
}];

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

function bad() {
  return Promise.resolve({ ok: false, json: () => Promise.resolve([]) } as Response);
}

function setup(fetchImpl: (url: string) => Promise<Response>) {
  const calls: PublicLocation[][] = [];
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = "visible";
  const fetchMock = vi.fn(fetchImpl);
  const loader = createPublicMapLoader({
    url: LIVE,
    fallbackUrl: STATIC,
    intervalMs: INTERVAL,
    fetchImpl: fetchMock as unknown as typeof fetch,
    doc,
    onLocations: (locations) => calls.push(locations),
  });
  return { calls, doc, fetchMock, loader };
}

describe("public map loader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads the live endpoint immediately", async () => {
    const { calls, fetchMock, loader } = setup(() => ok(live));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([LIVE]);
    expect(calls).toEqual([live]);
    loader.stop();
  });

  it.each(["non-2xx", "network", "invalid-json"])(
    "uses the static fallback when the first %s live request fails",
    async (failure) => {
      const { calls, fetchMock, loader } = setup((url) => {
        if (url === STATIC) return ok(fallback);
        if (failure === "non-2xx") return bad();
        if (failure === "network") return Promise.reject(new Error("offline"));
        return Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("invalid JSON")),
        } as Response);
      });
      loader.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([LIVE, STATIC]);
      expect(calls).toEqual([fallback]);
      loader.stop();
    },
  );

  it("accepts an empty successful live response without using the fallback", async () => {
    const { calls, fetchMock, loader } = setup(() => ok([]));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([[]]);
    loader.stop();
  });

  it("keeps the last good data when a refresh fails", async () => {
    let request = 0;
    const { calls, loader } = setup(() => (request++ === 0 ? ok(live) : bad()));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toEqual([live]);
    loader.stop();
  });

  it("refreshes every five minutes while visible", async () => {
    let request = 0;
    const { calls, fetchMock, loader } = setup(() => ok(request++ === 0 ? live : fallback));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([live, fallback]);
    loader.stop();
  });

  it("pauses while hidden and refreshes only when visible data is stale", async () => {
    const { doc, fetchMock, loader } = setup(() => ok(live));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    loader.stop();
  });

  it("does not refresh when visibility returns before the data is stale", async () => {
    const { doc, fetchMock, loader } = setup(() => ok(live));
    loader.start();
    await vi.advanceTimersByTimeAsync(0);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    loader.stop();
  });

  it("stops timers, listeners, and in-flight publication", async () => {
    let resolve!: (response: Response) => void;
    const { calls, doc, fetchMock, loader } = setup(
      () => new Promise<Response>((done) => { resolve = done; }),
    );
    loader.start();
    loader.stop();
    resolve({ ok: true, json: () => Promise.resolve(live) } as Response);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });
});
