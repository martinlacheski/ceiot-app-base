// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLandingContent, landingLocales, LOCALES } from "../src/i18n/content";

const SYNTHETIC_ENDPOINT = "https://api.example.test/custom/public/contact";
const SYNTHETIC_NUMBER = "5491112345678";

async function renderHome(locale = LOCALES.ES): Promise<string> {
  vi.resetModules();
  vi.doMock("../src/config/publicUrls", async (importOriginal) => ({
    ...(await importOriginal()),
    APP_LOGIN_URL: "https://app.example.test/login",
    CONTACT_ENDPOINT: SYNTHETIC_ENDPOINT,
    WHATSAPP_NUMBER: SYNTHETIC_NUMBER,
  }));
  const { default: HomePage } = await import("../src/components/HomePage.astro");
  const container = await AstroContainer.create();
  return container.renderToString(HomePage, { props: { content: getLandingContent(locale) } });
}

afterEach(() => {
  vi.doUnmock("../src/config/publicUrls");
  vi.resetModules();
});

describe("HomePage", () => {
  it("renders localized generic environmental content, icon, and contact form", async () => {
    for (const locale of landingLocales) {
      const content = getLandingContent(locale);
      const html = await renderHome(locale);

      expect(html).toContain(content.hero.heading);
      expect(html).toContain('src="/iot.png"');
      expect(html.match(/src="\/iot\.png"[^>]*width="512"[^>]*height="511"/g)).toHaveLength(3);
      expect(html).not.toMatch(/src="\/iot\.png"[^>]*height="512"/);
      expect(html).toContain('id="variables"');
      expect(html).toContain('id="contact"');
      expect(html).toContain('href="#contact"');
      expect(html.indexOf('href="#contact"')).toBeLessThan(html.indexOf('id="contact"'));
      expect(html).toContain('data-contact-form');
      expect(html).toContain("°C");
      expect(html).toContain("hPa");
      expect(html).toContain("data-theme-toggle");
      expect(html).not.toMatch(/DVEM|Matemetal|Mercado Pago|dvem_logo|device-viewer|google maps/i);
    }
  });

  it("places contact before the footer and preserves WhatsApp after the footer", async () => {
    const html = await renderHome();
    const contactIndex = html.indexOf('id="contact"');
    const footerIndex = html.indexOf("<footer");
    const whatsappIndex = html.indexOf("https://wa.me/");

    expect(contactIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(contactIndex);
    expect(whatsappIndex).toBeGreaterThan(footerIndex);
  });

  it("keeps the exact Spanish dashboard CTA label", async () => {
    const html = await renderHome(LOCALES.ES);

    expect(html).toContain("Acceder al sistema");
    expect(html).not.toContain("Acceder al panel");
  });
});
