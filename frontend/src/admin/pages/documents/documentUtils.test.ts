import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, POLL_INTERVAL_MS, embeddingLabel, fileExtension, formatBytes, pollInterval, statusOf, typeLabelOf, validateDocumentFile } from "./documentUtils";

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

describe("embedding labels", () => {
  it("names providers and models for the ingestion column", () => {
    expect(embeddingLabel("local", "baai/bge-m3")).toBe("Local · bge-m3");
    expect(embeddingLabel("openrouter", "baai/bge-m3")).toBe("OpenRouter · bge-m3");
    expect(embeddingLabel(null, null)).toBeNull();
    expect(embeddingLabel("custom", "x/y")).toBe("custom · y");
  });
});

describe("pollInterval", () => {
  it("polls only while some document is being processed", () => {
    expect(pollInterval([{ ingestionStatus: "ready" }, { ingestionStatus: "processing" }])).toBe(POLL_INTERVAL_MS);
    expect(pollInterval([{ ingestionStatus: "ready" }, { ingestionStatus: "failed" }, { ingestionStatus: "pending" }])).toBe(false);
    expect(pollInterval([])).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
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
