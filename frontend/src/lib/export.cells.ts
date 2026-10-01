// Lightweight (no PDF/Excel dependencies) so list screens can build typed cells without
// pulling jsPDF/ExcelJS into their bundle. Re-exported from "./export.utils".

/**
 * A typed export cell, shared by the Excel and PDF exporters.
 *
 * A plain `string` stays a text cell everywhere (unchanged behavior). Every other
 * variant carries the raw `value` (used by Excel to write a real number/date, with
 * a format that keeps `SUM`/`%`/date filtering working) plus `text` — exactly the
 * string the screen/PDF already show today, so the PDF never changes and Excel
 * never has to re-derive locale-specific formatting (currency symbol, decimals,
 * etc.) that the call site already computed correctly.
 */
export type ExportCell =
  | string
  | { kind: "integer"; value: number | null; text: string }
  | { kind: "decimal"; value: number | null; decimals: number; text: string }
  /** `value` is a fraction: 0.05 means 5%. */
  | { kind: "percent"; value: number | null; text: string }
  | { kind: "date"; value: Date | string | null; text: string }
  | { kind: "datetime"; value: Date | string | null; text: string };

export const integerCell = (value: number | null | undefined, text: string): ExportCell => ({
  kind: "integer",
  value: value ?? null,
  text,
});
export const decimalCell = (
  value: number | null | undefined,
  text: string,
  decimals = 2,
): ExportCell => ({ kind: "decimal", value: value ?? null, decimals, text });
/** `value` is a fraction: pass 0.05 for a screen value of "5%". */
export const percentCell = (value: number | null | undefined, text: string): ExportCell => ({
  kind: "percent",
  value: value ?? null,
  text,
});
export const dateCell = (value: Date | string | null | undefined, text: string): ExportCell => ({
  kind: "date",
  value: value ?? null,
  text,
});
export const datetimeCell = (value: Date | string | null | undefined, text: string): ExportCell => ({
  kind: "datetime",
  value: value ?? null,
  text,
});

/** Exactly what the PDF (and the Excel autofit pass) show for one cell today. */
export function cellText(cell: ExportCell): string {
  return typeof cell === "string" ? cell : cell.text;
}
