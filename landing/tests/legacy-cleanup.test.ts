import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectDir = process.cwd();
const publicDir = join(projectDir, "public");

const removedPaths = [
  "src/components/ContactSection.astro",
  "src/components/ClientsSection.astro",
  "src/components/DeviceSpinViewer.astro",
  "public/clients",
  "public/device-viewer",
  "public/dvem_logo.webp",
  "public/dvem_logo_invertido.webp",
  "public/favicon.svg",
  "public/logo.svg",
] as const;

describe("legacy landing cleanup", () => {
  it("keeps the compatibility map endpoint with an empty array payload", () => {
    const payload = JSON.parse(readFileSync(join(publicDir, "map-locations.json"), "utf8"));
    expect(payload).toEqual([]);
  });

  it("does not retain removed commercial routes, components, or public asset trees", () => {
    for (const relativePath of removedPaths) {
      expect(existsSync(join(projectDir, relativePath)), relativePath).toBe(false);
    }
  });
});
