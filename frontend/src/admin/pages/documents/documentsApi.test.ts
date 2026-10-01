import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { documentErrorMessage, documentsApi } from "./documentsApi";

vi.mock("@/api/appApi", () => ({ appApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("documentsApi", () => {
  it("maps list params to the snake_case query and omits empty ones", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { items: [] } });
    await documentsApi.list({ page: 2, perPage: 10, search: "", fileType: "pdf", ingestionStatus: "", sort: "title:asc" });
    expect(appApi.get).toHaveBeenCalledWith("/documents", { params: { page: 2, per_page: 10, file_type: "pdf", sort: "title:asc" } });
  });

  it("uploads multipart and reports progress as a percentage", async () => {
    const progress = vi.fn();
    vi.mocked(appApi.post).mockImplementation(async (_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 50, total: 200 } as never);
      return { data: { id: "d1" } };
    });
    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    await documentsApi.upload(file, progress);
    const [url, body] = vi.mocked(appApi.post).mock.calls[0];
    expect(url).toBe("/documents");
    expect((body as FormData).get("file")).toBe(file);
    expect(progress).toHaveBeenCalledWith(25);
  });

  it("queues ingestion of one document and reindexing of the stale or all documents", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: { id: "d1", queued: 2, documentIds: ["a", "b"] } });
    await documentsApi.ingest("d1");
    expect(appApi.post).toHaveBeenLastCalledWith("/documents/d1/ingest");
    expect(await documentsApi.reindex()).toEqual({ id: "d1", queued: 2, documentIds: ["a", "b"] });
    expect(appApi.post).toHaveBeenLastCalledWith("/documents/reindex", null, { params: {} });
    await documentsApi.reindex(true);
    expect(appApi.post).toHaveBeenLastCalledWith("/documents/reindex", null, { params: { all: true } });
  });

  it("downloads through the API as a blob and saves it with the original filename", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: new Blob(["x"]) });
    const create = vi.fn(() => "blob:1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await documentsApi.download({ id: "d1", filename: "informe.pdf" });
    expect(appApi.get).toHaveBeenCalledWith("/documents/d1/download", { responseType: "blob" });
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("extracts the Spanish detail from API errors", () => {
    expect(documentErrorMessage({ response: { data: { detail: "Almacenamiento no configurado" } } }, "x")).toBe("Almacenamiento no configurado");
    expect(documentErrorMessage({ response: { data: { detail: [{ msg: "bad" }] } } }, "fallback")).toBe("fallback");
    expect(documentErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
