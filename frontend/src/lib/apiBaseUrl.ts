/**
 * VITE_API_URL is baked into the bundle at build/dev-server start, so a
 * value like "http://localhost:8000/api" only works when the app is opened
 * from the same machine the backend runs on. When testing from another
 * device on the LAN (e.g. a phone hitting http://192.168.1.100:5173),
 * "localhost" resolves to that device itself, not the dev machine.
 *
 * In dev mode, if VITE_API_URL points at localhost/127.0.0.1, swap the host
 * for whatever hostname the browser actually used to load the page — so the
 * same .env value works whether you open the app via localhost or the LAN
 * IP. Production builds (VITE_API_URL pointing at a real domain) are left
 * untouched.
 */
function resolveApiBaseUrl(raw: string): string {
  if (!import.meta.env.DEV || !raw) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.hostname = window.location.hostname;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Not an absolute URL (e.g. a relative "/api" path) — nothing to rewrite.
  }

  return raw;
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
