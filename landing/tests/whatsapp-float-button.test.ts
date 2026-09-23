// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { afterEach, describe, expect, it, vi } from "vitest";

import WhatsAppFloatButton from "../src/components/WhatsAppFloatButton.astro";
import EsNotFoundPage from "../src/pages/404.astro";
import EnNotFoundPage from "../src/pages/en/404.astro";
import PtBrNotFoundPage from "../src/pages/pt-br/404.astro";
import { getLandingContent, landingLocales } from "../src/i18n/content";
import { createAstroContainer } from "./astro-container";

const SYNTHETIC_NUMBER = "5491112345678";

function decodeHtmlAttribute(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

async function renderHomePageWithNumber(number: string | undefined, localeIndex = 0): Promise<string> {
  vi.resetModules();
  vi.doMock("../src/config/publicUrls", async (importOriginal) => ({
    ...(await importOriginal()),
    WHATSAPP_NUMBER: number,
  }));

  const [{ default: HomePage }, { getLandingContent: getContent, landingLocales: locales }] = await Promise.all([
    import("../src/components/HomePage.astro"),
    import("../src/i18n/content"),
  ]);
  const container = await createAstroContainer();
  return container.renderToString(HomePage, { props: { content: getContent(locales[localeIndex]) } });
}

afterEach(() => {
  vi.doUnmock("../src/config/publicUrls");
  vi.resetModules();
});

describe("WhatsApp floating contact", () => {
  it("renders the historical floating appearance and an accessible safe external link", async () => {
    const content = getLandingContent(landingLocales[0]);
    const container = await createAstroContainer();
    const html = await container.renderToString(WhatsAppFloatButton, {
      props: {
        number: SYNTHETIC_NUMBER,
        message: content.whatsapp.message,
        label: content.whatsapp.label,
      },
    });

    const href = html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    const url = new URL(decodeHtmlAttribute(href!));
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe(`/${SYNTHETIC_NUMBER}`);
    expect(url.searchParams.get("text")).toBe(content.whatsapp.message);

    expect(html).toContain(`aria-label="${content.whatsapp.label}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]");
    expect(html).toContain("sm:right-6 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:size-16");
    expect(html).toContain("focus:ring-2 focus:ring-[#25D366]");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    expect(html).not.toContain("data-gtag-event");
  });

  it.each([undefined, "", "012345678", "+54 9 11 1234-5678", "1234567", "1234567890123456", "12345678?text=x"])(
    "renders nothing for absent or invalid number %s",
    async (number) => {
      const content = getLandingContent(landingLocales[0]);
      const container = await createAstroContainer();
      const html = await container.renderToString(WhatsAppFloatButton, {
        props: { number, message: content.whatsapp.message, label: content.whatsapp.label },
      });
      expect(html).not.toContain("wa.me");
      expect(html).not.toContain("<a");
    },
  );

  it("renders localized encoded messages from HomePage only when configuration is valid", async () => {
    for (const [index, locale] of landingLocales.entries()) {
      const html = await renderHomePageWithNumber(SYNTHETIC_NUMBER, index);
      const href = html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)?.[1];
      expect(href, locale).toBeDefined();
      const url = new URL(decodeHtmlAttribute(href!));
      expect(url.pathname).toBe(`/${SYNTHETIC_NUMBER}`);
      expect(url.searchParams.get("text")).toBe(getLandingContent(locale).whatsapp.message);
    }

    expect(await renderHomePageWithNumber(undefined)).not.toContain("wa.me");
    expect(await renderHomePageWithNumber("invalid-number")).not.toContain("wa.me");
  });

  it("does not render the contact button on localized 404 pages", async () => {
    const container = await createAstroContainer();
    for (const page of [EsNotFoundPage, EnNotFoundPage, PtBrNotFoundPage]) {
      const html = await container.renderToString(page);
      expect(html).not.toContain("wa.me");
      expect(html).not.toContain("WhatsApp");
    }
  });
});
