import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportToExcel } from "./export.utils";
import { loadReportBranding, REPORT_BRAND_TAGLINE } from "./report-branding";

vi.mock("./report-branding", async (importOriginal) => ({
  ...await importOriginal<typeof import("./report-branding")>(),
  loadReportBranding: vi.fn(),
}));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
const branding = {
  logo: { data: png, width: 512, height: 367 },
  right: { data: png, width: 512, height: 474 },
};
const options = {
  title: "Reporte de dispositivos",
  filename: "dispositivos",
  generatedBy: "Operador de prueba",
  columns: ["Nombre", "Monto"],
  data: [["Equipo 1", "100"], ["Totales", "100"]],
};
let blob: Blob | undefined;
const click = vi.fn();
const createObjectURL = vi.fn((value: Blob) => { blob = value; return "blob:report"; });
const revokeObjectURL = vi.fn();

beforeEach(() => {
  blob = undefined;
  vi.clearAllMocks();
  vi.mocked(loadReportBranding).mockResolvedValue(branding);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    click(this.download);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function readDownload() {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob!);
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

const columnPixels = (width: number) => Math.floor(width * 7 + 5);

describe("branded Excel export (real ExcelJS round trip)", () => {
  it.each([2, 8, 28])("embeds aligned images and headings without extra data columns (%i columns)", async (count) => {
    const columns = Array.from({ length: count }, (_, i) => `Col ${i + 1}`);
    const row = columns.map((_, i) => `${i}`);
    await exportToExcel({ ...options, columns, data: [row] });
    const workbook = await readDownload();
    const sheet = workbook.getWorksheet("Reporte")!;
    expect(sheet.columnCount).toBe(count);
    expect(sheet.getCell("A1").value).toBe(REPORT_BRAND_TAGLINE);
    expect(sheet.getCell("A1").font).toMatchObject({ name: "Arial", size: 10, bold: true });
    expect(sheet.getCell("A1").alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    expect(sheet.getCell("A1").alignment.wrapText).not.toBe(true);
    expect(sheet.getRow(1).height).toBe(42);
    expect(sheet.getRow(2).height).toBe(8);
    expect(sheet.getCell("A2").value).toBeNull();
    expect(sheet.getCell(2, count).isMerged).toBe(true);
    expect(sheet.getCell(2, count).master.address).toBe("A2");
    [1, 2, 3, 4].forEach((rowNumber) => {
      expect(sheet.getCell(rowNumber, 1).value).not.toBe("DVEM");
    });
    expect(sheet.getCell("A3").value).toBe(options.title);
    expect(sheet.getCell("A4").value).toContain(`Generado por: ${options.generatedBy} | Fecha:`);
    expect(sheet.getRow(6).values).toEqual([undefined, ...columns]);
    expect(sheet.getRow(7).values).toEqual([undefined, ...row]);
    [1, 3, 4, 6, 7].forEach((rowNumber) => {
      expect(sheet.getCell(rowNumber, 1).font.name).toBe("Arial");
    });
    const images = sheet.getImages();
    expect(images).toHaveLength(2);
    const widths = sheet.columns.map((column) => columnPixels(column.width!));
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    expect(totalWidth).toBeGreaterThanOrEqual(630);
    const textMetrics = new jsPDF();
    textMetrics.setFont("helvetica", "bold");
    textMetrics.setFontSize(10);
    const titleWidth = textMetrics.getTextWidth(REPORT_BRAND_TAGLINE) * 96 / 25.4;
    let logoRight = 0;
    images.forEach((image, index) => {
      const range = image.range as typeof image.range & { ext: { width: number; height: number } };
      const x = widths.slice(0, range.tl.nativeCol).reduce((sum, width) => sum + width, 0) + range.tl.nativeColOff / 9525;
      const y = range.tl.nativeRowOff / 9525;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(range.tl.nativeRow).toBe(0);
      expect(range.ext.width).toBeCloseTo(index === 0 ? 48 * 512 / 367 : 48 * 512 / 474, 3);
      expect(range.ext.height).toBeCloseTo(48);
      expect(y + range.ext.height / 2).toBeCloseTo(sheet.getRow(1).height! * 2 / 3);
      expect(y).toBeGreaterThan(0);
      expect(y + range.ext.height).toBeLessThanOrEqual(sheet.getRow(1).height! * 4 / 3);
      expect(x + range.ext.width).toBeLessThanOrEqual(totalWidth);
      if (index === 0) {
        logoRight = x + range.ext.width;
        expect(totalWidth / 2 - titleWidth / 2).toBeGreaterThan(logoRight + 8);
      } else {
        expect(x).toBeGreaterThan(totalWidth / 2 + titleWidth / 2 + 8);
      }
      expect(range.ext.width / range.ext.height).toBeCloseTo(index === 0 ? 512 / 367 : 512 / 474);
      expect(workbook.getImage(Number(image.imageId)).extension).toBe("png");
    });
    expect(sheet.pageSetup.printTitlesRow).toBe("1:6");
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    expect(sheet.pageSetup.fitToHeight).toBe(0);
    expect(sheet.pageSetup.margins?.left).toBeGreaterThan(0);
    expect(click).toHaveBeenCalledWith(expect.stringMatching(/^dispositivos_\d{8}_\d{4}\.xlsx$/));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
  });

  it("excludes title and metadata from autofit while preserving data and totals", async () => {
    await exportToExcel(options);
    const original = (await readDownload()).getWorksheet("Reporte")!;
    await exportToExcel({ ...options, title: "Reporte largo ".repeat(40), generatedBy: "Usuario extenso ".repeat(20) });
    const sheet = (await readDownload()).getWorksheet("Reporte")!;
    expect(sheet.columns.map((column) => column.width)).toEqual(original.columns.map((column) => column.width));
    expect(sheet.getRow(3).height).toBeGreaterThan(22);
    expect(sheet.getRow(4).height).toBeGreaterThan(20);
    expect(sheet.getRow(8).values).toEqual([undefined, "Totales", "100"]);
    expect(sheet.getCell("A8").font).toMatchObject({ name: "Arial", size: 11, bold: true });
    expect(sheet.getCell("A8").fill).toMatchObject({ fgColor: { argb: "FFE8F0FE" } });
    expect(sheet.getCell("A8").border.top).toMatchObject({ style: "medium" });
  });

  it("downloads nothing on asset failure and permits the next export", async () => {
    vi.mocked(loadReportBranding).mockRejectedValueOnce(new Error("asset failed"));
    await expect(exportToExcel(options)).rejects.toThrow("asset failed");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    await exportToExcel(options);
    expect((await readDownload()).getWorksheet("Reporte")!.getImages()).toHaveLength(2);
  });
});
