import { normalizePublicLocations, type PublicLocation } from "./publicMap";

export const PUBLIC_MAP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface VisibilityDocument {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PublicMapLoaderOptions {
  url: string;
  fallbackUrl: string;
  intervalMs?: number;
  onLocations: (locations: PublicLocation[]) => void;
  fetchImpl?: typeof fetch;
  doc?: VisibilityDocument;
}

export interface PublicMapLoader {
  start(): void;
  stop(): void;
}

export function createPublicMapLoader(options: PublicMapLoaderOptions): PublicMapLoader {
  const { url, fallbackUrl, onLocations } = options;
  const intervalMs = options.intervalMs ?? PUBLIC_MAP_REFRESH_INTERVAL_MS;
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL) => fetch(input));
  const doc = options.doc ?? (typeof document === "undefined" ? undefined : document);

  let stopped = true;
  let hasLoaded = false;
  let lastAttemptAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function request(target: string): Promise<PublicLocation[] | null> {
    try {
      const response = await doFetch(target);
      if (!response.ok) return null;
      return normalizePublicLocations(await response.json());
    } catch {
      return null;
    }
  }

  async function load(): Promise<void> {
    lastAttemptAt = Date.now();
    let data = await request(url);
    if (data === null && !hasLoaded) data = await request(fallbackUrl);
    if (stopped || data === null) return;
    hasLoaded = true;
    onLocations(data);
  }

  const isVisible = () => !doc || doc.visibilityState !== "hidden";

  function startTimer() {
    if (timer === undefined) timer = setInterval(() => void load(), intervalMs);
  }

  function stopTimer() {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function onVisibilityChange() {
    if (!isVisible()) {
      stopTimer();
      return;
    }
    if (Date.now() - lastAttemptAt >= intervalMs) void load();
    startTimer();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void load();
      if (isVisible()) startTimer();
      doc?.addEventListener("visibilitychange", onVisibilityChange);
    },
    stop() {
      stopped = true;
      stopTimer();
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
