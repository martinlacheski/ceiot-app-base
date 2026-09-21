import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectDir = process.cwd();
const publicDir = join(projectDir, "public");
const distDir = join(projectDir, "dist");
const globalCssPath = join(projectDir, "src/styles/global.css");
const distCssDir = join(distDir, "_astro");

const expectedFonts = [
  { path: "/fonts/montserrat-latin-400-600.woff2" },
] as const;

let buildExecuted = false;

function collectFilesRecursively(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFilesRecursively(absolutePath);
    }

    return absolutePath;
  });
}

function ensureBuildOutput(): void {
  if (buildExecuted) {
    return;
  }

  execSync("npm run build", {
    cwd: projectDir,
    stdio: "pipe",
  });

  buildExecuted = true;
}

describe("landing font assets", () => {
  it("ships the self-hosted Montserrat WOFF2 file used by the current design", () => {
    for (const font of expectedFonts) {
      expect(existsSync(join(publicDir, font.path))).toBe(true);
    }
  });

  it("defines local font-face rules with swap and no Google font CDN references", () => {
    const css = readFileSync(globalCssPath, "utf8");

    expect(css).toContain('font-family: "Montserrat"');
    expect(css).toContain("font-display: swap");
    expect(css).toContain("font-weight: 400 600;");
    expect(css).toContain('--font-sans: "Montserrat", ui-sans-serif, system-ui, sans-serif;');

    for (const font of expectedFonts) {
      expect(css).toContain(`src: url("${font.path}") format("woff2")`);
    }

    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });

  it("keeps the generated build CSS on local /fonts assets only", () => {
    ensureBuildOutput();

    const builtCss = collectFilesRecursively(distCssDir)
      .filter((filePath) => filePath.endsWith(".css"))
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");

    for (const font of expectedFonts) {
      expect(builtCss).toContain(font.path);
    }

    expect(builtCss).not.toContain("fonts.googleapis.com");
    expect(builtCss).not.toContain("fonts.gstatic.com");
  });
});
