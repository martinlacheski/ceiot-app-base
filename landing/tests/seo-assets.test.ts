import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LOCALES } from "../src/i18n/content";
import { buildSeoAssetLinks, getBrandLogoImage, getSocialPreviewImage } from "../src/seo/assets";

const publicDir = join(process.cwd(), "public");
const dimensions = (path: string) => {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

describe("landing SEO assets", () => {
  it("uses the crawler-safe brand icon for structured data", () => {
    expect(getBrandLogoImage()).toBe("/icon-512.png");
    expect(dimensions(join(publicDir, "icon-512.png"))).toEqual({ width: 512, height: 512 });
  });

  it("provides theme-aware favicon and install icon assets with declared dimensions", () => {
    expect(buildSeoAssetLinks()).toEqual([
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png", media: "(prefers-color-scheme: light)" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-dark-32.png", media: "(prefers-color-scheme: dark)" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ]);
    expect(dimensions(join(publicDir, "favicon-32.png"))).toEqual({ width: 32, height: 32 });
    expect(dimensions(join(publicDir, "favicon-dark-32.png"))).toEqual({ width: 32, height: 32 });
    expect(dimensions(join(publicDir, "apple-touch-icon.png"))).toEqual({ width: 180, height: 180 });
    expect(dimensions(join(publicDir, "icon-192.png"))).toEqual({ width: 192, height: 192 });
    expect(dimensions(join(publicDir, "icon-512.png"))).toEqual({ width: 512, height: 512 });

    const manifest = JSON.parse(readFileSync(join(publicDir, "site.webmanifest"), "utf8"));
    expect(manifest.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
  });

  it("ships a localized 1200x630 social image for every locale", () => {
    for (const [locale, filename] of [[LOCALES.ES, "og-image.png"], [LOCALES.PT_BR, "og-image-pt.png"], [LOCALES.EN, "og-image-en.png"]] as const) {
      expect(getSocialPreviewImage(locale)).toBe(`/${filename}`);
      const path = join(publicDir, filename);
      expect(existsSync(path)).toBe(true);
      expect(dimensions(path)).toEqual({ width: 1200, height: 630 });
    }
  });
});
