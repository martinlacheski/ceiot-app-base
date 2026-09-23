export type ReportFormat = "excel" | "pdf";

export interface ReportOptions {
  title: string;
  filename: string;
  generatedBy: string;
  columns: string[];
  data: string[][];
}

const WIDE_REPORT_COLUMNS = 6;

/** Builds and downloads an Excel or PDF file from already formatted rows. */
export async function downloadReport(format: ReportFormat, options: ReportOptions): Promise<void> {
  if (format === "excel") {
    const { exportToExcel } = await import("@/lib/export.utils");
    await exportToExcel(options);
    return;
  }
  const { exportToPdf } = await import("@/lib/export.utils");
  await exportToPdf({
    ...options,
    orientation: options.columns.length > WIDE_REPORT_COLUMNS ? "landscape" : "portrait",
  });
}

/** Keeps letters, digits, "-" and "_"; everything else becomes "_". */
export const toFilenamePart = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, "_");
