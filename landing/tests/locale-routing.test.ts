import { describe, expect, it } from "vitest";

import { resolveLocaleRedirectPath } from "../src/i18n/routing";

describe("locale redirect resolution", () => {
  it("routes Portuguese and English accept-language headers to prefixed locales", () => {
    expect(resolveLocaleRedirectPath("pt-BR,pt;q=0.9,en;q=0.8")).toBe("/pt-br/");
    expect(resolveLocaleRedirectPath("en-US,en;q=0.9,es;q=0.8")).toBe("/en/");
  });

  it("keeps Spanish and unknown languages on the default unprefixed locale", () => {
    expect(resolveLocaleRedirectPath("es-AR,es;q=0.9")).toBeNull();
    expect(resolveLocaleRedirectPath("fr-FR,fr;q=0.9")).toBeNull();
  });
});
