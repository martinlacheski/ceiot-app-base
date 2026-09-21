import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const publicSiteUrl = process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "");

export default defineConfig({
  ...(publicSiteUrl ? { site: publicSiteUrl } : {}),
  output: "static",
  i18n: {
    defaultLocale: "es",
    locales: ["es", "pt-br", "en"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [react(), ...(publicSiteUrl ? [sitemap()] : [])],
  vite: { plugins: [tailwindcss()] },
});
