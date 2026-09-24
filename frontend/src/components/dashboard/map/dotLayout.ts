export interface DotLayoutOptions {
  dotSize?: number;
  gap?: number;
  padding?: number;
}

export interface DotLayout {
  /** Offsets of each dot center from the badge center, in input order. */
  dots: { x: number; y: number }[];
  /** Diameter of the round badge holding the dots. */
  badgeSize: number;
}

/**
 * Lays out n dots as a regular polygon: 2 side by side, 3+ on the vertices of
 * an n-gon (first vertex on top, clockwise), spaced so neighbours never overlap.
 */
export function computeDotLayout(
  n: number,
  { dotSize = 12, gap = 3, padding = 4 }: DotLayoutOptions = {},
): DotLayout {
  if (n <= 1) {
    return { dots: [{ x: 0, y: 0 }], badgeSize: dotSize };
  }
  const radius =
    n === 2
      ? (dotSize + gap) / 2
      : (dotSize + gap) / (2 * Math.sin(Math.PI / n));
  const dots =
    n === 2
      ? [
          { x: -radius, y: 0 },
          { x: radius, y: 0 },
        ]
      : Array.from({ length: n }, (_, i) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
          return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
        });
  return { dots, badgeSize: 2 * (radius + dotSize / 2 + padding) };
}
