import { describe, expect, it } from "vitest";

import { computeDotLayout } from "./dotLayout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("computeDotLayout", () => {
  it("places a single dot at the center", () => {
    const { dots } = computeDotLayout(1);
    expect(dots).toEqual([{ x: 0, y: 0 }]);
  });

  it("places two dots side by side, symmetric on the horizontal axis", () => {
    const { dots } = computeDotLayout(2);
    expect(dots[0].y).toBeCloseTo(0);
    expect(dots[1].y).toBeCloseTo(0);
    expect(dots[0].x).toBeCloseTo(-dots[1].x);
    expect(dots[0].x).toBeLessThan(0);
  });

  it("places three dots as an equilateral triangle with vertex 0 on top", () => {
    const { dots } = computeDotLayout(3);
    expect(dots[0].x).toBeCloseTo(0);
    expect(dots[0].y).toBeLessThan(0);
    const d01 = dist(dots[0], dots[1]);
    expect(dist(dots[1], dots[2])).toBeCloseTo(d01);
    expect(dist(dots[0], dots[2])).toBeCloseTo(d01);
    // clockwise: vertex 1 is on the right
    expect(dots[1].x).toBeGreaterThan(0);
  });

  it("places four dots as a square", () => {
    const { dots } = computeDotLayout(4);
    const side = dist(dots[0], dots[1]);
    expect(dist(dots[1], dots[2])).toBeCloseTo(side);
    expect(dist(dots[2], dots[3])).toBeCloseTo(side);
    expect(dist(dots[3], dots[0])).toBeCloseTo(side);
    expect(dist(dots[0], dots[2])).toBeCloseTo(side * Math.SQRT2);
  });

  it("never overlaps dots for 2..8", () => {
    for (let n = 2; n <= 8; n++) {
      const { dots } = computeDotLayout(n, { dotSize: 12, gap: 3, padding: 4 });
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          expect(dist(dots[i], dots[j])).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it("supports a negative gap: neighbours overlap by a fixed amount without stacking", () => {
    const dotSize = 16;
    const gap = -6.4;
    for (let n = 2; n <= 8; n += 1) {
      const { dots } = computeDotLayout(n, { dotSize, gap, padding: 0 });
      for (let i = 0; i < n; i += 1) {
        const next = dots[(i + 1) % n];
        const distance = Math.hypot(dots[i].x - next.x, dots[i].y - next.y);
        if (n === 2 && i === 1) continue;
        expect(distance).toBeCloseTo(dotSize + gap, 5);
      }
    }
  });

  it("grows the badge with the number of dots", () => {
    let previous = 0;
    for (let n = 2; n <= 8; n++) {
      const { badgeSize } = computeDotLayout(n);
      expect(badgeSize).toBeGreaterThan(previous);
      previous = badgeSize;
    }
  });
});
