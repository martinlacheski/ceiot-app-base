import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPulseClient, parseSseFrames, type PulseEvent } from "./pulseClient";

const encoder = new TextEncoder();

/** A controllable SSE response body. */
function streamResponse(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(status === 200 ? body : null, {
      status,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const pulse = (deviceId: string, kind = "telemetry") =>
  `event: pulse\ndata: ${JSON.stringify({
    deviceId,
    serial: "IOT-1",
    environmentId: null,
    kind,
    time: "2026-05-01T12:00:00+00:00",
  })}\n\n`;

describe("parseSseFrames", () => {
  it("splits complete frames and keeps the incomplete tail", () => {
    const { frames, rest } = parseSseFrames(": connected\n\nevent: pulse\ndata: {\"a\":1}\n\nevent: pul");
    expect(frames).toEqual([
      { event: "message", data: "", comment: true },
      { event: "pulse", data: '{"a":1}', comment: false },
    ]);
    expect(rest).toBe("event: pul");
  });

  it("handles CRLF separators", () => {
    const { frames } = parseSseFrames("event: reauth\r\ndata: {}\r\n\r\n");
    expect(frames).toEqual([{ event: "reauth", data: "{}", comment: false }]);
  });
});

describe("createPulseClient", () => {
  let hidden = false;
  const listeners: Record<string, () => void> = {};

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(document, "addEventListener").mockImplementation(((type: string, cb: () => void) => {
      listeners[type] = cb;
    }) as typeof document.addEventListener);
    vi.spyOn(document, "removeEventListener").mockImplementation(((type: string) => {
      delete listeners[type];
    }) as typeof document.removeEventListener);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const setup = (fetchImpl: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => {
    const events: PulseEvent[] = [];
    const status: boolean[] = [];
    const onResync = vi.fn();
    const refreshToken = vi.fn(async () => "fresh-token");
    const client = createPulseClient({
      baseUrl: "http://api/api",
      getToken: () => "tok",
      refreshToken,
      onPulse: (e) => events.push(e),
      onStatusChange: (c) => status.push(c),
      onResync,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 0,
      ...extra,
    });
    return { client, events, status, onResync, refreshToken };
  };

  it("connects with the bearer header and delivers pulses, ignoring heartbeats", async () => {
    const s = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValue(s.response);
    const { client, events, status } = setup(fetchImpl);

    client.start();
    await flush();
    s.push(": connected\n\n");
    s.push(pulse("d1"));
    s.push(": heartbeat\n\n");
    s.push(pulse("d2", "presence"));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://api/api/live/pulse");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(events.map((e) => [e.deviceId, e.kind])).toEqual([
      ["d1", "telemetry"],
      ["d2", "presence"],
    ]);
    expect(status).toEqual([true]);
    client.stop();
  });

  it("reassembles frames split across chunks and ignores malformed data", async () => {
    const s = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValue(s.response);
    const { client, events } = setup(fetchImpl);

    client.start();
    await flush();
    const text = pulse("d1");
    s.push(text.slice(0, 15));
    await flush();
    s.push(text.slice(15));
    s.push("event: pulse\ndata: not-json\n\n");
    await flush();

    expect(events.map((e) => e.deviceId)).toEqual(["d1"]);
    client.stop();
  });

  it("reconnects with exponential backoff after the stream drops and resyncs", async () => {
    const first = streamResponse();
    const second = streamResponse();
    const third = streamResponse();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response)
      .mockResolvedValueOnce(third.response);
    const { client, status, onResync } = setup(fetchImpl);

    client.start();
    await flush();
    first.end();
    await flush();
    expect(status).toEqual([true, false]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // base delay
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    second.end();
    await flush();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // doubled delay
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onResync).toHaveBeenCalledTimes(2); // every reconnect resyncs missed pulses
    client.stop();
  });

  it("retries after a server error with backoff and caps the delay", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const { client } = setup(fetchImpl, { maxDelayMs: 4000 });

    client.start();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const delay of [1000, 2000, 4000, 4000]) {
      await vi.advanceTimersByTimeAsync(delay);
      await flush();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    client.stop();
  });

  it("refreshes the token on 401 and retries immediately with the new one", async () => {
    const ok = streamResponse();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(ok.response);
    const { client, refreshToken } = setup(fetchImpl);

    client.start();
    await flush();

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
    client.stop();
  });

  it("stops retrying when the token cannot be refreshed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const refreshToken = vi.fn(async () => null);
    const { client } = setup(fetchImpl, { refreshToken });

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("reconnects immediately, without backoff, on a reauth event", async () => {
    const first = streamResponse();
    const second = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client } = setup(fetchImpl);

    client.start();
    await flush();
    first.push("event: reauth\ndata: {}\n\n");
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it("pauses while the tab is hidden and resumes (with a resync) when visible again", async () => {
    const first = streamResponse();
    const second = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client, status, onResync } = setup(fetchImpl);

    client.start();
    await flush();
    hidden = true;
    listeners.visibilitychange();
    await flush();
    expect(status.at(-1)).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    hidden = false;
    listeners.visibilitychange();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onResync).toHaveBeenCalled();
    client.stop();
  });

  it("does not connect while hidden at start", async () => {
    hidden = true;
    const fetchImpl = vi.fn();
    const { client } = setup(fetchImpl);
    client.start();
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    client.stop();
  });

  it("reconnects when the stream goes silent past the heartbeat watchdog", async () => {
    const first = streamResponse();
    const second = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client } = setup(fetchImpl, { silenceTimeoutMs: 45_000 });

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(44_000);
    first.push(": heartbeat\n\n"); // a heartbeat resets the watchdog
    await flush();
    await vi.advanceTimersByTimeAsync(44_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it("stop() aborts the request and never reconnects", async () => {
    const s = streamResponse();
    const fetchImpl = vi.fn().mockResolvedValue(s.response);
    const { client, status } = setup(fetchImpl);

    client.start();
    await flush();
    const signal: AbortSignal = fetchImpl.mock.calls[0][1].signal;
    client.stop();
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(status.at(-1)).toBe(false);
  });
});
