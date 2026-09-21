import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LOCALES } from "../src/i18n/content";
import { buildSeoAssetLinks, getBrandLogoImage, getSocialPreviewImage } from "../src/seo/assets";

const publicDir = join(process.cwd(), "public");
const rootDir = join(process.cwd(), "..");
const dimensions = (path: string) => {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("landing SEO assets", () => {
  it("uses the supplied IoT art byte-for-byte in both web contexts", () => {
    const source = join(rootDir, "docs/iot.png");
    expect(dimensions(source)).toEqual({ width: 512, height: 511 });
    expect(dimensions(join(publicDir, "iot.png"))).toEqual({ width: 512, height: 511 });
    expect(digest(join(publicDir, "iot.png"))).toBe(digest(source));
    expect(digest(join(rootDir, "frontend/public/iot.png"))).toBe(digest(source));
    expect(getBrandLogoImage()).toBe("/iot.png");
  });

  it("provides generated icon assets with declared dimensions", () => {
    expect(buildSeoAssetLinks()).toEqual([
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ]);
    expect(dimensions(join(publicDir, "favicon-32.png"))).toEqual({ width: 32, height: 32 });
    expect(dimensions(join(publicDir, "apple-touch-icon.png"))).toEqual({ width: 180, height: 180 });
    expect(dimensions(join(publicDir, "icon-192.png"))).toEqual({ width: 192, height: 192 });
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
