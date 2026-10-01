import { appApi } from "@/api/appApi";

export interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string | null;
  isActive: boolean;
  ingestionStatus: string;
  ingestedAt: string | null;
  error: string | null;
  chunkCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  /** Indexed with another provider/model than the configured ones: retrieval skips it until reindexed. */
  needsReindex: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPage {
  items: DocumentItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface DocumentListParams {
  page: number;
  perPage: number;
  search?: string;
  fileType?: string;
  ingestionStatus?: string;
  sort?: string;
}

export interface ReindexResult {
  queued: number;
  documentIds: string[];
}

/** The API answers `detail` in Spanish; fall back to a generic message. */
export function documentErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

export const documentsApi = {
  async list(params: DocumentListParams): Promise<DocumentPage> {
    const { data } = await appApi.get("/documents", {
      params: {
        page: params.page,
        per_page: params.perPage,
        ...(params.search ? { search: params.search } : {}),
        ...(params.fileType ? { file_type: params.fileType } : {}),
        ...(params.ingestionStatus ? { ingestion_status: params.ingestionStatus } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
      },
    });
    return data;
  },

  async upload(file: File, onProgress?: (percent: number) => void): Promise<DocumentItem> {
    const body = new FormData();
    body.append("file", file);
    const { data } = await appApi.post("/documents", body, {
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
    return data;
  },

  /** Queues (re)indexing of one document; the server answers 202 with status "processing". */
  async ingest(id: string): Promise<DocumentItem> {
    const { data } = await appApi.post(`/documents/${id}/ingest`);
    return data;
  },

  /** Queues the stale/failed/pending documents, or every document with `all`. */
  async reindex(all = false): Promise<ReindexResult> {
    const { data } = await appApi.post("/documents/reindex", null, { params: all ? { all: true } : {} });
    return data;
  },

  async rename(id: string, title: string): Promise<DocumentItem> {
    const { data } = await appApi.patch(`/documents/${id}`, { title });
    return data;
  },

  async remove(id: string): Promise<void> {
    await appApi.delete(`/documents/${id}`);
  },

  /** Streams through the API (the browser never reaches object storage) and saves the blob. */
  async download(item: Pick<DocumentItem, "id" | "filename">): Promise<void> {
    const { data } = await appApi.get<Blob>(`/documents/${item.id}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = item.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
