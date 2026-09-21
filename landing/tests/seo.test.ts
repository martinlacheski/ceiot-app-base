import { describe, expect, it } from "vitest";

import { getLandingContent, LOCALES } from "../src/i18n/content";
import { buildAbsoluteUrl, buildAlternateLinks, buildJsonLdGraph } from "../src/seo/metadata";

const SITE = "https://environment.example.test";

describe("landing SEO metadata", () => {
  it("omits absolute metadata when no public site origin is configured", () => {
    expect(buildAbsoluteUrl("/en/", undefined)).toBeUndefined();
    expect(buildAlternateLinks(undefined)).toEqual([]);
    expect(buildJsonLdGraph(getLandingContent(LOCALES.ES), undefined)).toEqual([]);
  });

  it("builds canonical and hreflang values from an explicit public origin", () => {
    expect(buildAbsoluteUrl("/en/", SITE)).toBe(`${SITE}/en/`);
    expect(buildAlternateLinks(SITE)).toEqual([
      { hreflang: "es", href: `${SITE}/` },
      { hreflang: "pt-BR", href: `${SITE}/pt-br/` },
      { hreflang: "en", href: `${SITE}/en/` },
      { hreflang: "x-default", href: `${SITE}/` },
    ]);
  });

  it("publishes generic Organization and WebSite structured data", () => {
    const graph = buildJsonLdGraph(getLandingContent(LOCALES.EN), SITE);
    expect(graph).toHaveLength(2);
    expect(graph[0]).toMatchObject({ "@type": "Organization", name: "Monitoreo Ambiental IoT", logo: `${SITE}/iot.png` });
    expect(graph[1]).toMatchObject({ "@type": "WebSite", name: "IoT Environmental Monitoring", url: `${SITE}/en/`, inLanguage: "en" });
    expect(JSON.stringify(graph)).not.toMatch(/DVEM|Product|SoftwareApplication|Offer/i);
  });
});
