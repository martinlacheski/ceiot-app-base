import JsPDF, { type jsPDF, type jsPDFOptions } from "jspdf";
import type { Table } from "jspdf-autotable";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ doc: undefined as jsPDF | undefined }));
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  return {
    ...actual,
    default: vi.fn(function (options: jsPDFOptions) {
      const doc = new actual.jsPDF(options);
      vi.spyOn(doc, "save").mockReturnValue(doc);
      vi.spyOn(doc, "addImage");
      vi.spyOn(doc, "text");
      vi.spyOn(doc, "rect");
      capture.doc = doc;
      return doc;
    }),
  };
});
vi.mock("./report-branding", async (importOriginal) => ({
  ...await importOriginal<typeof import("./report-branding")>(),
  loadReportBranding: vi.fn(),
}));

import { exportToPdf } from "./export.utils";
import { loadReportBranding, REPORT_BRAND_TAGLINE } from "./report-branding";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
const branding = {
  logo: { data: png, width: 512, height: 367 },
  right: { data: png, width: 512, height: 474 },
};
const options = {
  title: "Resumen diario de movimientos",
  filename: "resumen_movimientos",
  generatedBy: "Operador de prueba",
  columns: ["Dispositivo", "Monto"],
  data: [["Equipo 1", "100"], ["Totales", "100"]],
};

beforeEach(() => {
  capture.doc = undefined;
  vi.mocked(loadReportBranding).mockReset().mockResolvedValue(branding);
});

describe("branded PDF export (real jsPDF and AutoTable)", () => {
  it("enables compression for full-resolution branding", async () => {
    await exportToPdf(options);
    expect(JsPDF).toHaveBeenLastCalledWith({ orientation: "portrait", compress: true });
  });

  it.each(["portrait", "landscape"] as const)("repeats both images and headings inside every %s page", async (orientation) => {
    await exportToPdf({ ...options, orientation, margin: orientation === "landscape" ? 5 : 14, data: Array.from({ length: 180 }, (_, i) => [`Equipo ${i}`, "100"]) });
    const doc = capture.doc!;
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const table = (doc as jsPDF & { lastAutoTable: Table }).lastAutoTable;
    expect(doc.addImage).toHaveBeenCalledTimes(doc.getNumberOfPages() * 2);
    const imageCalls = vi.mocked(doc.addImage).mock.calls as unknown as Array<[string, string, number, number, number, number]>;
    imageCalls.forEach(([, , x, y, width, height]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(pageWidth);
      expect(y + height).toBeLessThan(table.settings.margin.top);
      expect(y + height).toBeLessThan(pageHeight);
    });
    expect(imageCalls[0][4] / imageCalls[0][5]).toBeCloseTo(512 / 367);
    expect(imageCalls[1][4] / imageCalls[1][5]).toBeCloseTo(512 / 474);
    for (let index = 0; index < imageCalls.length; index += 2) {
      const logo = imageCalls[index];
      const right = imageCalls[index + 1];
      expect(logo[5]).toBeCloseTo(12);
      expect(logo[4]).toBeCloseTo(12 * 512 / 367);
      expect(right[5]).toBeCloseTo(12);
      expect(right[4]).toBeCloseTo(12 * 512 / 474);
      expect(logo[3] + logo[5] / 2).toBeCloseTo(right[3] + right[5] / 2);
      expect(logo[2] + logo[4]).toBeLessThan(right[2]);
    }
    const textCalls = vi.mocked(doc.text).mock.calls as unknown as Array<[string | string[], number, number]>;
    const headingCalls = textCalls.filter(([text]) => text === REPORT_BRAND_TAGLINE);
    expect(headingCalls).toHaveLength(doc.getNumberOfPages());
    headingCalls.forEach(([, x, y]) => {
      const logo = imageCalls[0];
      const right = imageCalls[1];
      const left = logo[2] + logo[4] + 6;
      const rightBound = right[2] - 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      const width = doc.getTextWidth(REPORT_BRAND_TAGLINE);
      expect(x).toBeCloseTo((left + rightBound) / 2);
      expect(x - width / 2).toBeGreaterThanOrEqual(left);
      expect(x + width / 2).toBeLessThanOrEqual(rightBound);
      expect(y).toBeCloseTo(right[3] + right[5] / 2);
    });
    const rectangles = vi.mocked(doc.rect).mock.calls;
    expect(rectangles.filter(([, y]) => y < table.settings.margin.top)).toHaveLength(0);
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      const content = (doc.internal.pages as unknown as string[][])[page].join("\n");
      expect(content).not.toContain("(DVEM)");
      expect(content).toContain(`(${REPORT_BRAND_TAGLINE})`);
      expect(content).toContain("/F2 12 Tf");
      expect(content).toContain(`(${options.title})`);
      expect(content).toContain(`/I0 Do`);
      expect(content).toContain(`/I1 Do`);
      expect(content).toContain(`Página ${page} de ${doc.getNumberOfPages()}`);
      expect(content).toContain(`Generado por: ${options.generatedBy} | Fecha:`);
    }
    table.body.forEach((row) => expect(row.cells[0].y).toBeGreaterThanOrEqual(table.settings.margin.top));
    expect(doc.save).toHaveBeenCalledWith(expect.stringMatching(/^resumen_movimientos_\d{8}_\d{4}\.pdf$/));
  });

  it("wraps a long report title above the table and preserves totals styling", async () => {
    const title = "Pagos confirmados - Establecimiento con nombre extenso ".repeat(4).trim();
    await exportToPdf({ ...options, title });
    const doc = capture.doc!;
    const table = (doc as jsPDF & { lastAutoTable: Table }).lastAutoTable;
    const textCalls = vi.mocked(doc.text).mock.calls as unknown as Array<[string | string[], number, number]>;
    const reportTitle = textCalls.find(([text]) => Array.isArray(text) && text.join(" ") === title);
    expect(reportTitle).toBeDefined();
    const tagline = textCalls.find(([text]) => text === REPORT_BRAND_TAGLINE);
    expect(tagline).toBeDefined();
    expect(reportTitle![2]).toBeGreaterThan(tagline![2]);
    expect(table.settings.margin.top).toBeGreaterThan(reportTitle![2] + (reportTitle![0] as string[]).length * 4);
    expect(table.body.at(-1)?.cells[0].styles.fontStyle).toBe("bold");
    expect(table.body.at(-1)?.cells[0].styles.fillColor).toEqual([232, 240, 254]);
  });

  it("waits for all branding before creating or downloading a document", async () => {
    let resolve!: (value: typeof branding) => void;
    vi.mocked(loadReportBranding).mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = exportToPdf(options);
    expect(capture.doc).toBeUndefined();
    resolve(branding);
    await result;
    expect(capture.doc!.save).toHaveBeenCalledOnce();
  });

  it("rejects asset failure without downloading a partial report", async () => {
    vi.mocked(loadReportBranding).mockRejectedValue(new Error("asset failed"));
    await expect(exportToPdf(options)).rejects.toThrow("asset failed");
    expect(capture.doc).toBeUndefined();
  });

  it("still brands a report with no data rows", async () => {
    await exportToPdf({ ...options, data: [] });
    expect(capture.doc!.getNumberOfPages()).toBe(1);
    expect(capture.doc!.addImage).toHaveBeenCalledTimes(2);
  });
});
