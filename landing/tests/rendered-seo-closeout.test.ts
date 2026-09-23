// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import EsHomePage from "../src/pages/index.astro";
import EnHomePage from "../src/pages/en/index.astro";
import PtBrHomePage from "../src/pages/pt-br/index.astro";

const pages = [
  { component: EsHomePage, lang: "es", title: "Monitoreo Ambiental IoT", image: "/og-image.png" },
  { component: PtBrHomePage, lang: "pt-BR", title: "Monitoramento Ambiental IoT", image: "/og-image-pt.png" },
  { component: EnHomePage, lang: "en", title: "IoT Environmental Monitoring", image: "/og-image-en.png" },
] as const;

describe("rendered generic landing metadata", () => {
  it("renders localized identity without unsupported absolute metadata or trackers", async () => {
    const container = await AstroContainer.create();
    for (const page of pages) {
      const html = await container.renderToString(page.component);
      expect(html).toContain(`<html lang="${page.lang}">`);
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain(`<meta property="og:site_name" content="${page.title}">`);
      expect(html).not.toContain('<link rel="canonical"');
      expect(html).not.toContain('rel="alternate" hreflang=');
      expect(html).not.toContain('property="og:image"');
      expect(html).not.toMatch(/googletagmanager|clarity\.ms|posthog|G-JSZDRL13SB|dvem\.io/i);
    }
  });

  it("references the generated icon and manifest assets", async () => {
    const html = await (await AstroContainer.create()).renderToString(EsHomePage);
    expect(html).toContain('href="/favicon-32.png"');
    expect(html).toContain('href="/favicon-dark-32.png"');
    expect(html).toContain('media="(prefers-color-scheme: light)"');
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('href="/site.webmanifest"');
    expect(html).toContain('src="/icon-light-512.png"');
    expect(html).toContain('src="/icon-dark-512.png"');
    expect(html).not.toMatch(/\/iot[.]png/);
    expect(html).not.toContain('/favicon.svg');
  });
});
