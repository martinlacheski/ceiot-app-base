import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadReport, toFilenamePart } from "./downloadReport";

const { exportToExcel, exportToPdf } = vi.hoisted(() => ({
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
}));

vi.mock("@/lib/export.utils", () => ({ exportToExcel, exportToPdf }));

const base = {
  title: "Historial",
  filename: "historial",
  generatedBy: "Ana",
  data: [["a"]],
};

describe("downloadReport", () => {
  beforeEach(() => {
    exportToExcel.mockReset();
    exportToPdf.mockReset();
  });

  it("sends the rows to the Excel exporter", async () => {
    await downloadReport("excel", { ...base, columns: ["A"] });

    expect(exportToExcel).toHaveBeenCalledWith({ ...base, columns: ["A"] });
    expect(exportToPdf).not.toHaveBeenCalled();
  });

  it("prints wide PDFs (more than 6 columns) in landscape and narrow ones in portrait", async () => {
    await downloadReport("pdf", { ...base, columns: ["1", "2", "3", "4", "5", "6", "7"] });
    await downloadReport("pdf", { ...base, columns: ["1", "2"] });

    expect(exportToPdf.mock.calls[0][0].orientation).toBe("landscape");
    expect(exportToPdf.mock.calls[1][0].orientation).toBe("portrait");
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it("makes a serial safe for a filename", () => {
    expect(toFilenamePart("DVEM/OLD 0001")).toBe("DVEM_OLD_0001");
    expect(toFilenamePart("DVEM-OLD_0001")).toBe("DVEM-OLD_0001");
  });
});
