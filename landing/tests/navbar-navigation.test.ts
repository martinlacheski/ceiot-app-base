// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLandingContent, landingLocales, LOCALES } from "../src/i18n/content";
import { getNotFoundContent } from "../src/i18n/notFound";
import { createAstroContainer } from "./astro-container";

const SYNTHETIC_ENDPOINT = "https://api.example.test/custom/public/contact";
const SYNTHETIC_NUMBER = "5491112345678";
const CONTACT_LABELS = {
  [LOCALES.ES]: "Contacto",
  [LOCALES.EN]: "Contact",
  [LOCALES.PT_BR]: "Contato",
} as const;

async function loadComponents() {
  vi.resetModules();
  vi.doMock("../src/config/publicUrls", async (importOriginal) => ({
    ...(await importOriginal()),
    APP_LOGIN_URL: "https://app.example.test/login",
    CONTACT_ENDPOINT: SYNTHETIC_ENDPOINT,
    WHATSAPP_NUMBER: SYNTHETIC_NUMBER,
  }));

  const [{ default: HomePage }, { default: Navbar }, { default: NotFoundPage }] = await Promise.all([
    import("../src/components/HomePage.astro"),
    import("../src/components/Navbar.astro"),
    import("../src/components/NotFoundPage.astro"),
  ]);
  return { HomePage, Navbar, NotFoundPage };
}

function contactAnchors(html: string, label: string): string[] {
  return html.match(new RegExp(`<a[^>]*href="#contact"[^>]*>${label}</a>`, "g")) ?? [];
}

afterEach(() => {
  vi.doUnmock("../src/config/publicUrls");
  vi.resetModules();
});

describe("Navbar contact navigation", () => {
  it("renders the exact localized contact link in both home-page menus", async () => {
    for (const locale of landingLocales) {
      const content = getLandingContent(locale);
      const { HomePage } = await loadComponents();
      const container = await createAstroContainer();
      const html = await container.renderToString(HomePage, { props: { content } });
      const label = CONTACT_LABELS[locale];

      expect(content.nav.contactLabel).toBe(label);
      expect(contactAnchors(html, label)).toHaveLength(2);
      expect(html).toContain('<section id="contact"');
    }
  });

  it("uses complementary lg breakpoints for desktop navigation and the mobile menu", async () => {
    const { HomePage } = await loadComponents();
    const container = await createAstroContainer();
    const html = await container.renderToString(HomePage, {
      props: { content: getLandingContent(LOCALES.ES) },
    });

    expect(html).toMatch(/<nav class="[^"]*hidden[^"]*lg:flex[^"]*">[\s\S]*?href="#contact"/);
    expect(html).toMatch(/<details class="[^"]*lg:hidden[^"]*">[\s\S]*?href="#contact"/);
    expect(html).not.toContain('details class="group relative sm:hidden"');
  });

  it("keeps contact opt-in when a home render is followed by the 404", async () => {
    const content = getLandingContent(LOCALES.EN);
    const originalLinks = content.nav.links.map((link) => ({ ...link }));
    const { HomePage, Navbar, NotFoundPage } = await loadComponents();
    const container = await createAstroContainer();

    const homeHtml = await container.renderToString(HomePage, { props: { content } });
    const notFoundHtml = await container.renderToString(NotFoundPage, {
      props: { content, notFound: getNotFoundContent(LOCALES.EN) },
    });
    const defaultNavbarHtml = await container.renderToString(Navbar, { props: { content } });

    expect(contactAnchors(homeHtml, CONTACT_LABELS[LOCALES.EN])).toHaveLength(2);
    expect(notFoundHtml).not.toContain('href="#contact"');
    expect(defaultNavbarHtml).not.toContain('href="#contact"');
    expect(content.nav.links).toEqual(originalLinks);
    expect(content.nav.links).not.toContainEqual({ href: "#contact", label: CONTACT_LABELS[LOCALES.EN] });
  });
  it("shows the localized privacy link in both header menus, unified with the footer", async () => {
    const labels = {
      [LOCALES.ES]: "Privacidad",
      [LOCALES.PT_BR]: "Privacidade",
      [LOCALES.EN]: "Privacy",
    } as const;

    for (const locale of landingLocales) {
      const content = getLandingContent(locale);
      const { Navbar } = await loadComponents();
      const container = await createAstroContainer();
      const html = await container.renderToString(Navbar, { props: { content } });
      const anchors = html.match(new RegExp(`<a[^>]*href="/privacidad/"[^>]*>${labels[locale]}</a>`, "g")) ?? [];

      expect(anchors).toHaveLength(2);
      expect(content.footer.links).toContainEqual({ href: "/privacidad/", label: labels[locale] });
    }
  });
});
