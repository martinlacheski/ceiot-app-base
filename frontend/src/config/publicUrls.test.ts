import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_LOGIN_URL,
  DEFAULT_LANDING_URL,
  resolvePublicUrl,
} from "./publicUrls";

describe("public urls", () => {
  it("falls back to production urls when env values are missing", () => {
    expect(resolvePublicUrl(undefined, DEFAULT_APP_LOGIN_URL)).toBe(DEFAULT_APP_LOGIN_URL);
    expect(resolvePublicUrl(undefined, DEFAULT_LANDING_URL)).toBe(DEFAULT_LANDING_URL);
  });

  it("prefers trimmed env overrides for local development", () => {
    expect(
      resolvePublicUrl(" http://localhost:5173/auth/login ", DEFAULT_APP_LOGIN_URL),
    ).toBe("http://localhost:5173/auth/login");
    expect(
      resolvePublicUrl(" http://localhost:4321/ ", DEFAULT_LANDING_URL),
    ).toBe("http://localhost:4321/");
  });
});
