import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, fileExtension, formatBytes, statusOf, typeLabelOf, validateDocumentFile } from "./documentUtils";

describe("validateDocumentFile", () => {
  it("accepts PDF, TXT, MD and DOCX regardless of case", () => {
    for (const name of ["a.pdf", "b.TXT", "c.md", "d.DocX"]) expect(validateDocumentFile({ name, size: 10 })).toBeNull();
  });
  it("rejects other types, missing extensions, empty and oversized files", () => {
    expect(validateDocumentFile({ name: "a.exe", size: 10 })).toMatch(/Formato no permitido/);
    expect(validateDocumentFile({ name: "noext", size: 10 })).toMatch(/Formato no permitido/);
    expect(validateDocumentFile({ name: "a.txt", size: 0 })).toMatch(/vacío/);
    expect(validateDocumentFile({ name: "a.txt", size: MAX_DOCUMENT_BYTES })).toBeNull();
    expect(validateDocumentFile({ name: "a.txt", size: MAX_DOCUMENT_BYTES + 1 })).toMatch(/20 MB/);
  });
});

describe("formatting helpers", () => {
  it("formats sizes with a decimal comma", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
  });
  it("labels types and falls back to pending for unknown ingestion states", () => {
    expect(fileExtension("a.b.PDF")).toBe("pdf");
    expect(typeLabelOf("a.docx")).toBe("Word (DOCX)");
    expect(statusOf("ready")).toBe("ready");
    expect(statusOf("weird")).toBe("pending");
  });
});
