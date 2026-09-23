// @ts-nocheck -- Astro's test-only virtual module types are resolved by Vitest.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import Footer from "../src/components/Footer.astro";
import EsPrivacyPage from "../src/pages/privacidad.astro";
import PtBrPrivacyPage from "../src/pages/pt-br/privacidade.astro";
import EnPrivacyPage from "../src/pages/en/privacy.astro";
import { getLandingContent, LOCALES } from "../src/i18n/content";

const pages = [
  { locale: LOCALES.ES, page: EsPrivacyPage, path: "/privacidad/", home: "/", title: "Política de Privacidad", eyebrow: "Legal", description: "Cómo Monitoreo Ambiental IoT trata los datos personales y técnicos de sus usuarios.", update: "Última actualización: 23 de septiembre de 2026", headings: ["Quiénes somos y alcance", "Datos de cuenta e inicio de sesión", "Establecimientos, dispositivos y mediciones", "Invitaciones y acceso de invitados", "Mapa público", "Formulario de contacto y WhatsApp", "Finalidades del tratamiento", "Terceros", "Almacenamiento en el navegador y sesión", "Seguridad", "Derechos de las personas", "Actualizaciones de esta política"] },
  { locale: LOCALES.PT_BR, page: PtBrPrivacyPage, path: "/pt-br/privacidade/", home: "/pt-br/", title: "Política de Privacidade", eyebrow: "Informações legais", description: "Como o Monitoramento Ambiental IoT trata os dados pessoais e técnicos de seus usuários.", update: "Última atualização: 23 de setembro de 2026", headings: ["Quem somos e escopo", "Dados da conta e login", "Estabelecimentos, dispositivos e medições", "Convites e acesso de convidados", "Mapa público", "Formulário de contato e WhatsApp", "Finalidades do tratamento", "Terceiros", "Armazenamento no navegador e sessão", "Segurança", "Direitos das pessoas", "Atualizações desta política"] },
  { locale: LOCALES.EN, page: EnPrivacyPage, path: "/en/privacy/", home: "/en/", title: "Privacy Policy", eyebrow: "Legal", description: "How IoT Environmental Monitoring handles its users' personal and technical data.", update: "Last updated: September 23, 2026", headings: ["Who we are and scope", "Account and sign-in data", "Establishments, devices, and measurements", "Invitations and guest access", "Public map", "Contact form and WhatsApp", "Purposes of processing", "Third parties", "Browser storage and session", "Security", "Individual rights", "Updates to this policy"] },
] as const;

describe("localized privacy policy", () => {
  it.each(pages)("renders all 12 translated sections and metadata for $locale", async ({ page, title, eyebrow, description, update, headings }) => {
    const html = await (await AstroContainer.create()).renderToString(page);
    expect(html).toContain(`<title>${title} |`);
    expect(html).toContain(`>${title}</h1>`);
    expect(html).toContain(`<meta name="description" content="${description}">`);
    expect(html).toContain(`<p class="eyebrow">${eyebrow}</p>`);
    expect(html).toContain(update);
    expect(html.match(/<h2 id="privacy-\d+"/g)).toHaveLength(12);
    for (const heading of headings) expect(html).toContain(heading);
    expect(html).toContain("Ley 25.326");
    expect(html).not.toMatch(/DVEM|Mercado Pago|pagos?|payment|dispensers?|admin@|dvem\.io/i);
  });

  it.each(pages)("uses locale-specific home fragments and privacy links for $locale", async ({ page, path, home }) => {
    const html = await (await AstroContainer.create()).renderToString(page);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header.match(new RegExp(`href="${home}#contact"`, "g"))).toHaveLength(2);
    expect(header).not.toContain('href="#');
    for (const target of pages) {
      expect(header.match(new RegExp(`href="${target.path}"`, "g"))).toHaveLength(target.path === path ? 4 : 2);
    }
  });

  it.each(pages)("links the $locale footer to its own policy", async ({ locale, path }) => {
    const content = getLandingContent(locale);
    const html = await (await AstroContainer.create()).renderToString(Footer, { props: { content } });
    expect(content.footer.links.at(-1)?.href).toBe(path);
    expect(html).toContain(`href="${path}"`);
  });

  it("points the footer language links to the privacy page of each language", async () => {
    const html = await (await AstroContainer.create()).renderToString(EnPrivacyPage);
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));

    expect(footer).toContain('href="/privacidad/">ES</a>');
    expect(footer).toContain('href="/pt-br/privacidade/">PT-BR</a>');
    expect(footer).toContain('href="/en/privacy/">EN</a>');
    expect(footer).not.toContain('href="/">ES</a>');
  });
});
