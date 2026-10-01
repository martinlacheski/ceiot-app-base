export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_EXTENSIONS = ["pdf", "txt", "md", "docx"] as const;
export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const DOCUMENT_TYPE_LABELS: Record<DocumentExtension, string> = {
  pdf: "PDF",
  txt: "Texto (TXT)",
  md: "Markdown (MD)",
  docx: "Word (DOCX)",
};

export const INGESTION_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  ready: "Listo",
  failed: "Con error",
};

export const INGESTION_STATUS_VARIANTS: Record<IngestionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  processing: "outline",
  ready: "default",
  failed: "destructive",
};

export const fileExtension = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
};

export const isDocumentExtension = (value: string): value is DocumentExtension =>
  (DOCUMENT_EXTENSIONS as readonly string[]).includes(value);

/** Mirrors the server rules so the user gets feedback before uploading; the server stays authoritative. */
export function validateDocumentFile(file: { name: string; size: number }): string | null {
  if (!isDocumentExtension(fileExtension(file.name))) {
    return "Formato no permitido. Usá PDF, TXT, MD o DOCX.";
  }
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `El archivo supera el máximo de ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1).replace(".", ",");
  return `${text} ${units[unit]}`;
}

export const typeLabelOf = (filename: string): string => {
  const ext = fileExtension(filename);
  return isDocumentExtension(ext) ? DOCUMENT_TYPE_LABELS[ext] : ext.toUpperCase() || "—";
};

export const statusOf = (value: string): IngestionStatus =>
  (INGESTION_STATUSES as readonly string[]).includes(value) ? (value as IngestionStatus) : "pending";

export const POLL_INTERVAL_MS = 3000;

/** Refetch interval for the list: only while some document is being indexed. */
export const pollInterval = (items: ReadonlyArray<{ ingestionStatus: string }> | undefined): number | false =>
  items?.some((item) => item.ingestionStatus === "processing") ? POLL_INTERVAL_MS : false;

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = { local: "Local", openrouter: "OpenRouter" };

/** "Local · bge-m3": which provider/model produced a document's vectors. */
export function embeddingLabel(provider: string | null, model: string | null): string | null {
  if (!provider) return null;
  const shortModel = (model ?? "").split("/").pop() || "—";
  return `${EMBEDDING_PROVIDER_LABELS[provider] ?? provider} · ${shortModel}`;
}
