// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import Footer from "../src/components/Footer.astro";
import PrivacyPage from "../src/pages/privacidad.astro";
import { getLandingContent, landingLocales, LOCALES } from "../src/i18n/content";

describe("privacy policy", () => {
  it("renders the Spanish policy with its own SEO metadata and no alternates", async () => {
    const html = await (await AstroContainer.create()).renderToString(PrivacyPage);

    expect(html).toContain("<title>Política de Privacidad | Monitoreo Ambiental IoT</title>");
    expect(html).toContain(
      '<meta name="description" content="Cómo Monitoreo Ambiental IoT trata los datos personales y técnicos de sus usuarios.">',
    );
    expect(html).toContain("Política de Privacidad");
    expect(html).toContain("Última actualización: 23 de septiembre de 2026");
    expect(html).not.toContain('rel="alternate" hreflang=');
  });

  it("covers the source-backed policy sections without legacy business references", async () => {
    const html = await (await AstroContainer.create()).renderToString(PrivacyPage);
    for (const heading of [
      "Quiénes somos y alcance",
      "Datos de cuenta e inicio de sesión",
      "Establecimientos, dispositivos y mediciones",
      "Invitaciones y acceso de invitados",
      "Mapa público",
      "Formulario de contacto y WhatsApp",
      "Terceros",
      "Almacenamiento en el navegador y sesión",
      "Seguridad",
      "Derechos de las personas",
    ]) {
      expect(html).toContain(heading);
    }

    expect(html).toContain("Ley 25.326");
    expect(html).toContain("formulario de contacto");
    expect(html).toContain("sin identificar a propietarios");
    expect(html).not.toMatch(/DVEM|Mercado Pago|pagos?|payment|dispensers?/i);
    expect(html).not.toMatch(/admin@|dvem\.io/i);
  });

  it("shows the localized privacy link in every locale footer", async () => {
    const labels = {
      [LOCALES.ES]: "Privacidad",
      [LOCALES.PT_BR]: "Privacidade",
      [LOCALES.EN]: "Privacy",
    } as const;

    for (const locale of landingLocales) {
      const content = getLandingContent(locale);
      const html = await (await AstroContainer.create()).renderToString(Footer, {
        props: { content },
      });
      expect(content.footer.links).toContainEqual({
        href: "/privacidad/",
        label: labels[locale],
      });
      expect(html).toContain(`href="/privacidad/">${labels[locale]}</a>`);
    }
  });
});
