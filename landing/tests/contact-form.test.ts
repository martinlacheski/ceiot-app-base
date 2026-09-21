// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import ContactForm from "../src/components/ContactForm.astro";
import EsNotFoundPage from "../src/pages/404.astro";
import EnNotFoundPage from "../src/pages/en/404.astro";
import PtBrNotFoundPage from "../src/pages/pt-br/404.astro";
import { getLandingContent, landingLocales } from "../src/i18n/content";

const SYNTHETIC_ENDPOINT = "https://api.example.test/custom/public/contact";

describe("ContactForm", () => {
  it.each(landingLocales)("renders accessible %s form semantics", async (locale) => {
    const content = getLandingContent(locale);
    const container = await AstroContainer.create();
    const html = await container.renderToString(ContactForm, {
      props: { content: content.contact, endpoint: SYNTHETIC_ENDPOINT },
    });

    expect(html).toContain('<section id="contact" class="section-shell scroll-mt-20 fade-in-section">');
    expect(html).toContain('data-contact-form');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
    expect(html).toContain('name="website"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-describedby="contact-name-help contact-status"');
    expect(html).toContain('autocomplete="name"');
    expect(html).toContain('autocomplete="email"');
    expect(html).toContain('minlength="4"');
    expect(html).toContain('maxlength="120"');
    expect(html).toContain('minlength="10"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain(content.contact.noScript);
    expect(html).not.toContain('method="get"');
  });

  it("does not render on localized 404 pages", async () => {
    const container = await AstroContainer.create();
    for (const page of [EsNotFoundPage, EnNotFoundPage, PtBrNotFoundPage]) {
      const html = await container.renderToString(page);
      expect(html).not.toContain('data-contact-form');
      expect(html).not.toContain('id="contact"');
    }
  });

  it("renders a disabled unavailable path without an API endpoint", async () => {
    const content = getLandingContent(landingLocales[0]);
    const container = await AstroContainer.create();
    const html = await container.renderToString(ContactForm, {
      props: { content: content.contact, endpoint: undefined },
    });

    expect(html).not.toContain(SYNTHETIC_ENDPOINT);
    expect(html).toContain('data-contact-available="false"');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain(content.contact.unavailable);
  });
});
