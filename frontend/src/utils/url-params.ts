/**
 * Positive integer from a URL param. Missing, non-numeric, fractional, zero or
 * negative values fall back; with `max`, larger values are clamped to it.
 */
export const toPositiveInt = (
  value: string | null,
  fallback: number,
  max?: number,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return max === undefined ? parsed : Math.min(parsed, max);
};
