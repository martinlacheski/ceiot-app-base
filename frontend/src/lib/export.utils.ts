import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { loadReportBranding, REPORT_BRAND_TAGLINE } from "./report-branding";

interface ExportPdfOptions {
  title: string;
  filename: string;
  generatedBy: string;
  columns: string[];
  data: string[][];
  orientation?: "portrait" | "landscape";
  fontSize?: number;
  margin?: number;
  columnStyles?: Record<
    number,
    {
      cellWidth?: number;
      halign?: "left" | "center" | "right";
      overflow?: "linebreak" | "ellipsize" | "visible" | "hidden";
    }
  >;
}

const TOTALS_LABEL = "Totales";
function fitPdfColumnStyles(
  styles: ExportPdfOptions["columnStyles"],
  minimumWidths: number[],
  availableWidth: number,
): NonNullable<ExportPdfOptions["columnStyles"]> {
  const fitted = { ...styles };
  let remainingWidth = availableWidth;
  let fixedColumns = minimumWidths.flatMap((minimum, index) => {
    const requested = styles?.[index]?.cellWidth;
    if (typeof requested === "number") {
      return [{ index, minimum, width: Math.max(requested, minimum) }];
    }
    remainingWidth -= minimum;
    return [];
  });

  // Scale fixed widths proportionally, pinning any header minimum before redistributing.
  while (fixedColumns.length) {
    const total = fixedColumns.reduce((sum, column) => sum + column.width, 0);
    const scale = Math.min(1, Math.max(0, remainingWidth) / total);
    const pinned = fixedColumns.filter((column) => column.width * scale < column.minimum);
    if (!pinned.length) {
      fixedColumns.forEach(({ index, width }) => {
        fitted[index] = { ...styles?.[index], cellWidth: width * scale };
      });
      break;
    }
    pinned.forEach(({ index, minimum }) => {
      fitted[index] = { ...styles?.[index], cellWidth: minimum };
      remainingWidth -= minimum;
    });
    fixedColumns = fixedColumns.filter((column) => !pinned.includes(column));
  }
  return fitted;
}

function getExcelColumnName(columnNumber: number): string {
  let result = "";
  let current = Math.max(columnNumber, 1);

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function isTotalsRow(row: unknown): boolean {
  return Array.isArray(row) && row[0] === TOTALS_LABEL;
}

export const exportToPdf = async ({
  title,
  filename,
  generatedBy,
  columns,
  data,
  orientation = "portrait",
  fontSize = 10,
  margin = 14,
  columnStyles,
}: ExportPdfOptions) => {
  const branding = await loadReportBranding();
  const doc = new jsPDF({ orientation, compress: true });

  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  const logoHeight = 12;
  const logoWidth = logoHeight * branding.logo.width / branding.logo.height;
  const rightHeight = 12;
  const rightWidth = rightHeight * branding.right.width / branding.right.height;
  const imageTop = 10;
  const rowCenter = imageTop + rightHeight / 2;
  const rightX = pageWidth - margin - rightWidth;
  const headingCenter = (margin + logoWidth + 6 + rightX - 6) / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const titleLines: string[] = doc.splitTextToSize(title, pageWidth - margin * 2);
  const titleY = imageTop + rightHeight + 6;
  const headerBottom = titleY + titleLines.length * 5;
  const tableTop = headerBottom + 5;

  const drawHeader = () => {
    doc.addImage(branding.logo.data, "PNG", margin, rowCenter - logoHeight / 2,
      logoWidth, logoHeight, "report-logo");
    doc.addImage(branding.right.data, "PNG", rightX,
      imageTop, rightWidth, rightHeight, "report-right");
    doc.setTextColor(35);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(REPORT_BRAND_TAGLINE, headingCenter, rowCenter, { align: "center", baseline: "middle" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(titleLines, pageWidth / 2, titleY, { align: "center", lineHeightFactor: 1.25 });
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(0.5);
    doc.line(margin, headerBottom, pageWidth - margin, headerBottom);
  };

  const reportColumns = columns;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  const availableWidth = pageWidth - margin * 2;
  const wordWidths = reportColumns.map((label) =>
    Math.max(...label.split(/[^\S\u00a0]+/).map((word) => doc.getTextWidth(word))) + 3.2,
  );
  // Prefer complete words; for an impossible schema, keep the table inside its page.
  const minimumScale = Math.min(1, availableWidth / wordWidths.reduce((sum, width) => sum + width, 0));
  const headerMinimumWidths = wordWidths.map((width) => width * minimumScale);
  const fittedColumnStyles = fitPdfColumnStyles(columnStyles, headerMinimumWidths, availableWidth);

  // --- Table ---
  autoTable(doc, {
    startY: tableTop,
    head: [reportColumns],
    body: data,
    styles: {
      fontSize,
      cellPadding: 1.4,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [41, 128, 185],
      fontSize,
      halign: "center",
      valign: "middle",
    },
    columnStyles: fittedColumnStyles,
    margin: { top: tableTop, right: margin, bottom: 30, left: margin },
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        // Prevent body content from squeezing otherwise readable header words.
        hookData.cell.styles.minCellWidth = Math.max(
          hookData.cell.styles.minCellWidth,
          headerMinimumWidths[hookData.column.index],
        );
      }
      if (hookData.section !== "body" || !isTotalsRow(hookData.row.raw)) return;

      hookData.cell.styles.fontStyle = "bold";
      hookData.cell.styles.fillColor = [232, 240, 254];
      hookData.cell.styles.lineColor = [41, 128, 185];
      hookData.cell.styles.lineWidth = 0.35;
    },
    willDrawPage: drawHeader,
  });

  // --- Footer ---
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    doc.setFontSize(8);
    doc.setTextColor(100);

    const now = format(new Date(), "dd/MM/yyyy HH:mm");
    const footerY = pageHeight - 10;

    const footerText = `Generado por: ${generatedBy} | Fecha: ${now}`;
    doc.text(footerText, margin, footerY);

    // Right: Page X of Y
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, footerY, {
      align: "right",
    });
  }

  doc.save(`${filename}_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
};

import ExcelJS from "exceljs";

export const exportToExcel = async ({
  title,
  filename,
  generatedBy,
  columns,
  data,
}: ExportPdfOptions) => {
  const branding = await loadReportBranding();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Reporte");
  const lastColumn = getExcelColumnName(columns.length);

  const now = format(new Date(), "dd/MM/yyyy HH:mm");
  const headings = [
    { row: 1, text: REPORT_BRAND_TAGLINE, size: 10, bold: true },
    { row: 3, text: title, size: 12, bold: true },
    { row: 4, text: `Generado por: ${generatedBy} | Fecha: ${now}`, size: 10, italic: true },
  ];
  headings.forEach((heading) => {
    const row = heading.row;
    worksheet.mergeCells(`A${row}:${lastColumn}${row}`);
    const cell = worksheet.getCell(row, 1);
    cell.value = heading.text;
    cell.font = { name: "Arial", size: heading.size, bold: heading.bold, italic: heading.italic };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: row !== 1 };
  });
  worksheet.getRow(1).height = 42;
  worksheet.getRow(2).height = 8;
  worksheet.mergeCells(`A2:${lastColumn}2`);
  worksheet.addRow([]);

  // Add Headers
  const reportColumns = columns;
  const headerRow = worksheet.addRow(reportColumns);
  if (reportColumns.some((label) => label.includes("\n"))) headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2980B9" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: String(cell.value).includes("\n") };
  });

  // Add Data
  data.forEach((row) => {
    const worksheetRow = worksheet.addRow(row);
    worksheetRow.font = { name: "Arial", size: 11 };
    if (!isTotalsRow(row)) return;

    worksheetRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8F0FE" },
      };
      cell.border = {
        top: { style: "medium", color: { argb: "FF2980B9" } },
        bottom: { style: "medium", color: { argb: "FF2980B9" } },
        left: { style: "thin", color: { argb: "FF2980B9" } },
        right: { style: "thin", color: { argb: "FF2980B9" } },
      };
    });
  });

  // Auto-fit columns
  worksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber < headerRow.number) return;
      const columnLength = cell.value ? Math.max(...cell.value.toString().split("\n").map((line) => line.length)) : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

  // Keep narrow tables wide enough for branding, without adding data columns.
  const totalWidth = worksheet.columns.reduce((sum, column) => sum + (column.width ?? 10), 0);
  const extraWidth = Math.max(0, 100 - totalWidth) / Math.max(columns.length, 1);
  worksheet.columns.forEach((column) => { column.width = (column.width ?? 10) + extraWidth; });
  const columnPixels = worksheet.columns.map((column) => Math.floor(column.width! * 7 + 5));
  const sheetWidth = columnPixels.reduce((sum, width) => sum + width, 0);
  headings.slice(1).forEach((heading) => {
    const charactersPerLine = Math.max(1, Math.floor((sheetWidth - 24) / heading.size));
    const lines = heading.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
    worksheet.getRow(heading.row).height = Math.max(22, lines * heading.size * 1.5);
  });

  const addHeaderImage = (image: typeof branding.logo, x: number, width: number, height: number) => {
    let column = 0;
    let offset = x;
    while (column < columnPixels.length - 1 && offset >= columnPixels[column]) {
      offset -= columnPixels[column++];
    }
    // Native EMU offsets avoid ExcelJS fractional-column width approximations.
    const anchor = {
      col: column, row: 0, nativeCol: column, nativeRow: 0,
      nativeColOff: Math.round(offset * 9525),
      nativeRowOff: Math.round((56 - height) / 2 * 9525),
    };
    const imageId = workbook.addImage({ base64: image.data, extension: "png" });
    worksheet.addImage(imageId, { tl: anchor, ext: { width, height }, editAs: "absolute" });
  };
  const brandImageHeight = 48;
  const logoWidth = brandImageHeight * branding.logo.width / branding.logo.height;
  addHeaderImage(branding.logo, 8, logoWidth, brandImageHeight);
  const rightWidth = brandImageHeight * branding.right.width / branding.right.height;
  addHeaderImage(branding.right, sheetWidth - rightWidth - 8, rightWidth, brandImageHeight);
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: columns.length > 8 ? "landscape" : "portrait",
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    printTitlesRow: `1:${headerRow.number}`,
    printArea: `A1:${lastColumn}${worksheet.rowCount}`,
    horizontalCentered: true,
  };

  // Write Buffer
  const buffer = await workbook.xlsx.writeBuffer();

  // Create Blob and Download
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
};
