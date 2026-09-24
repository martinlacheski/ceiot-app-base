/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest stubs CSS imports, so the stylesheet is read from disk.
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

describe("theme chart colors", () => {
  it("defines every --chart-N as a complete color in light and dark themes", () => {
    // Charts use var(--chart-N) directly as a stroke color; bare HSL components render invisible lines.
    const values = [...css.matchAll(/--chart-[1-5]:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(values.length).toBeGreaterThanOrEqual(10);
    for (const value of values) {
      expect(value).toMatch(/^(hsl|oklch|rgb)\(/);
    }
  });
});
