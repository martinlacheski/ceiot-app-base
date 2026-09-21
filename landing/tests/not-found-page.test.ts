// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import EsNotFoundPage from "../src/pages/404.astro";
import EnNotFoundPage from "../src/pages/en/404.astro";
import PtBrNotFoundPage from "../src/pages/pt-br/404.astro";

const pages = [
  { component: EsNotFoundPage, lang: "es", title: "Página no encontrada | Monitoreo Ambiental IoT", home: "/" },
  { component: PtBrNotFoundPage, lang: "pt-BR", title: "Página não encontrada | Monitoramento Ambiental IoT", home: "/pt-br/" },
  { component: EnNotFoundPage, lang: "en", title: "Page not found | IoT Environmental Monitoring", home: "/en/" },
] as const;

describe("localized 404 pages", () => {
  it("uses generic identity, the shared icon, and one safe return action", async () => {
    const container = await AstroContainer.create();
    for (const page of pages) {
      const html = await container.renderToString(page.component);
      expect(html).toContain(`<html lang="${page.lang}">`);
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain('<meta name="robots" content="noindex, follow">');
      expect(html.match(/src="\/iot\.png"[^>]*width="512"[^>]*height="511"/g)).toHaveLength(3);
      expect(html).not.toMatch(/src="\/iot\.png"[^>]*height="512"/);
      expect(html).toContain(`href="${page.home}"`);
      expect(html).not.toContain('href="#contact"');
      expect(html).not.toMatch(/DVEM|contacto|whatsapp|404_.*\.webp/i);
    }
  });
});
