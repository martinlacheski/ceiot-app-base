import { LOCALES, type Locale } from "../i18n/content";

interface SeoAssetLink {
  rel: "icon" | "apple-touch-icon" | "manifest";
  href: string;
  type?: string;
  sizes?: string;
  media?: string;
}

const SOCIAL_PREVIEW_IMAGE_BY_LOCALE: Record<Locale, string> = {
  [LOCALES.ES]: "/og-image.png",
  [LOCALES.PT_BR]: "/og-image-pt.png",
  [LOCALES.EN]: "/og-image-en.png",
};

export function buildSeoAssetLinks(): SeoAssetLink[] {
  return [
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png", media: "(prefers-color-scheme: light)" },
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-dark-32.png", media: "(prefers-color-scheme: dark)" },
    { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    { rel: "manifest", href: "/site.webmanifest" },
  ];
}

export function getSocialPreviewImage(locale: Locale): string {
  return SOCIAL_PREVIEW_IMAGE_BY_LOCALE[locale];
}

export function getBrandLogoImage(): string {
  return "/icon-512.png";
}
