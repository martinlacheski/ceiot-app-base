import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

export const exportToPdf = ({
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
  const doc = new jsPDF({ orientation });

  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // --- Header ---
  // Logo (Text substitute for now, assuming logo.svg might be tricky to load reliably in strict environment)
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Monitoreo Ambiental IoT", margin, 20);

  // Title
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(title, margin, 30);

  // Date in Header? User asked for Date in Footer.
  // We can draw a line
  doc.setLineWidth(0.5);
  doc.line(margin, 35, pageWidth - margin, 35);

  // --- Table ---
  autoTable(doc, {
    startY: 40,
    head: [columns],
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
    columnStyles,
    margin: { top: 40, right: margin, bottom: 30, left: margin },
    didParseCell: (hookData) => {
      if (hookData.section !== "body" || !isTotalsRow(hookData.row.raw)) return;

      hookData.cell.styles.fontStyle = "bold";
      hookData.cell.styles.fillColor = [232, 240, 254];
      hookData.cell.styles.lineColor = [41, 128, 185];
      hookData.cell.styles.lineWidth = 0.35;
    },
    didDrawPage: () => {
      // Logic for repetitive header if needed (autoTable handles it)
    },
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
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Reporte");
  const lastColumn = getExcelColumnName(columns.length);

  // Add Title
  worksheet.mergeCells(`A1:${lastColumn}1`);
  const titleCell = worksheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: "center" };

  // Add Metadata
  worksheet.mergeCells(`A2:${lastColumn}2`);
  const metaCell = worksheet.getCell("A2");
  const now = format(new Date(), "dd/MM/yyyy HH:mm");
  metaCell.value = `Generado por: ${generatedBy} | Fecha: ${now}`;
  metaCell.font = { size: 10, italic: true };
  metaCell.alignment = { horizontal: "center" };

  // Add Empty Row
  worksheet.addRow([]);

  // Add Headers
  const headerRow = worksheet.addRow(columns);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2980B9" },
    };
    cell.alignment = { horizontal: "center" };
  });

  // Add Data
  data.forEach((row) => {
    const worksheetRow = worksheet.addRow(row);
    if (!isTotalsRow(row)) return;

    worksheetRow.eachCell((cell) => {
      cell.font = { bold: true };
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
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

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
