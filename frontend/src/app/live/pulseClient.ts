/**
 * Single shared connection to GET /live/pulse (Server-Sent Events).
 *
 * Opened with `fetch` instead of `EventSource` on purpose: EventSource cannot
 * send an Authorization header, and a token in the query string would leak into
 * proxy logs and browser history. The stream carries the same bearer token as
 * every other API call and refreshes it on 401.
 *
 * Framework-free so it can be tested with a mocked `fetch`; `useLivePulse`
 * wires it to TanStack Query.
 */

export type PulseKind = "telemetry" | "status" | "presence";

export interface PulseEvent {
  deviceId: string;
  serial: string | null;
  environmentId: string | null;
  kind: PulseKind;
  time: string;
}

export interface SseFrame {
  event: string;
  data: string;
  comment: boolean;
}

/** Split a text buffer into complete SSE frames and the unfinished tail. */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const data: string[] = [];
    let hasField = false;
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") {
        event = value;
        hasField = true;
      } else if (field === "data") {
        data.push(value);
        hasField = true;
      }
    }
    frames.push({ event, data: data.join("\n"), comment: !hasField });
  }
  return { frames, rest };
}

export interface PulseClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Returns a fresh access token, or null when the session cannot be renewed. */
  refreshToken: () => Promise<string | null>;
  onPulse: (event: PulseEvent) => void;
  onStatusChange?: (connected: boolean) => void;
  /** Called after every reconnection: pulses may have been missed meanwhile. */
  onResync?: () => void;
  fetchImpl?: typeof fetch;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Reconnect when nothing (not even a heartbeat) arrived for this long. */
  silenceTimeoutMs?: number;
  /** A connection older than this counts as healthy and resets the backoff. */
  stableAfterMs?: number;
  random?: () => number;
}

export interface PulseClient {
  start: () => void;
  stop: () => void;
}

const isPulseEvent = (value: unknown): value is PulseEvent =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { deviceId?: unknown }).deviceId === "string";

type EndReason = "dropped" | "reauth";

export function createPulseClient(options: PulseClientOptions): PulseClient {
  const {
    baseUrl,
    getToken,
    refreshToken,
    onPulse,
    onStatusChange,
    onResync,
    minDelayMs = 1000,
    maxDelayMs = 30_000,
    silenceTimeoutMs = 45_000,
    stableAfterMs = 30_000,
    random = Math.random,
  } = options;

  let running = false;
  let current: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let hasConnected = false;
  let connected = false;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    onStatusChange?.(value);
  };

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const schedule = (delayMs: number) => {
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delayMs);
  };

  const backoffDelay = () => {
    const base = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
    attempt += 1;
    return Math.min(maxDelayMs, base * (1 + random() * 0.3));
  };

  const request = (token: string, signal: AbortSignal) =>
    (options.fetchImpl ?? fetch)(`${baseUrl}/live/pulse`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      credentials: "include",
      cache: "no-store",
      signal,
    });

  async function read(response: Response, controller: AbortController): Promise<EndReason> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (watchdog !== null) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        controller.abort();
        // Unblock a pending read even if the transport ignores the abort signal.
        reader.cancel().catch(() => {});
      }, silenceTimeoutMs);
    };
    arm();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return "dropped";
        arm();
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (frame.comment) continue;
          if (frame.event === "reauth") return "reauth";
          if (frame.event === "unavailable") return "dropped";
          if (frame.event !== "pulse") continue;
          try {
            const payload: unknown = JSON.parse(frame.data);
            if (isPulseEvent(payload)) onPulse(payload);
          } catch {
            // Ignore a malformed frame; the next one may be fine.
          }
        }
      }
    } finally {
      if (watchdog !== null) clearTimeout(watchdog);
      reader.cancel().catch(() => {});
    }
  }

  async function connect(): Promise<void> {
    if (!running || current !== null || document.hidden) return;
    const controller = new AbortController();
    current = controller;
    let reason: EndReason = "dropped";
    let openedAt = 0;
    try {
      let token = getToken() ?? (await refreshToken());
      if (!token) {
        running = false;
        return;
      }
      let response = await request(token, controller.signal);
      if (response.status === 401) {
        token = await refreshToken();
        if (!token) {
          // The session is over; the app's own auth flow takes it from here.
          running = false;
          return;
        }
        response = await request(token, controller.signal);
      }
      if (!response.ok || !response.body) throw new Error(`pulse stream ${response.status}`);
      openedAt = Date.now();
      setConnected(true);
      if (hasConnected) onResync?.();
      hasConnected = true;
      reason = await read(response, controller);
    } catch {
      // Network error, abort (pause/stop/silence) or bad status: handled below.
    }
    setConnected(false);
    if (current !== controller) return; // paused or stopped while this ran
    current = null;
    if (!running) return;
    if (openedAt && Date.now() - openedAt >= stableAfterMs) attempt = 0;
    if (reason === "reauth") {
      schedule(0);
      return;
    }
    schedule(backoffDelay());
  }

  const pause = () => {
    clearRetry();
    const controller = current;
    current = null;
    controller?.abort();
    setConnected(false);
  };

  const onVisibilityChange = () => {
    if (!running) return;
    if (document.hidden) {
      pause();
    } else if (current === null) {
      attempt = 0;
      clearRetry();
      void connect();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
      void connect();
    },
    stop() {
      running = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      pause();
    },
  };
}
