import { PUBLIC_SITE_URL } from "../config/publicUrls";
import { landingLocales, LOCALES, type LandingContent, type Locale } from "../i18n/content";
import { getBrandLogoImage } from "./assets";

interface AlternateLink { hreflang: string; href: string }
type JsonLdNode = Record<string, unknown>;

const ROUTE_BY_LOCALE: Record<Locale, string> = {
  [LOCALES.ES]: "/",
  [LOCALES.PT_BR]: "/pt-br/",
  [LOCALES.EN]: "/en/",
};

const HREFLANG_BY_LOCALE: Record<Locale, string> = {
  [LOCALES.ES]: "es",
  [LOCALES.PT_BR]: "pt-BR",
  [LOCALES.EN]: "en",
};

const OG_LOCALE_BY_LOCALE: Record<Locale, string> = {
  [LOCALES.ES]: "es_419",
  [LOCALES.PT_BR]: "pt_BR",
  [LOCALES.EN]: "en_US",
};

export const SITE_URL = PUBLIC_SITE_URL;

export function buildAbsoluteUrl(path: string, siteUrl = SITE_URL): string | undefined {
  return siteUrl ? new URL(path, `${siteUrl}/`).toString() : undefined;
}

export function buildAlternateLinks(siteUrl = SITE_URL): AlternateLink[] {
  if (!siteUrl) return [];
  return [
    ...landingLocales.map((locale) => ({ hreflang: HREFLANG_BY_LOCALE[locale], href: buildAbsoluteUrl(ROUTE_BY_LOCALE[locale], siteUrl)! })),
    { hreflang: "x-default", href: buildAbsoluteUrl("/", siteUrl)! },
  ];
}

export function getOpenGraphLocale(locale: Locale): string {
  return OG_LOCALE_BY_LOCALE[locale];
}

export function getAlternateOpenGraphLocales(locale: Locale): string[] {
  return landingLocales.filter((item) => item !== locale).map(getOpenGraphLocale);
}

export function buildJsonLdGraph(content: LandingContent, siteUrl = SITE_URL): JsonLdNode[] {
  if (!siteUrl) return [];
  const url = buildAbsoluteUrl(content.path, siteUrl)!;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Monitoreo Ambiental IoT",
      url: siteUrl,
      logo: buildAbsoluteUrl(getBrandLogoImage(), siteUrl),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: content.hero.heading,
      url,
      description: content.seo.description,
      inLanguage: content.lang,
    },
  ];
}
