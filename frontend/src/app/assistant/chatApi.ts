import { appApi } from "@/api/appApi";

export type ChatMode = "auto" | "datos" | "documentos";
export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatSource {
  documentId: string;
  title: string;
  page: number | null;
  section: string | null;
  /** Cosine distance (lower is closer). */
  distance: number;
  excerpt: string;
}

export interface ChatSql {
  query: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export interface ChatResponse {
  answer: string;
  route: { datos: boolean; documentos: boolean; mode: string };
  sql: ChatSql | null;
  sources: ChatSource[];
  trace: string[];
  warnings: string[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Present on assistant messages that came from the API. */
  response?: ChatResponse;
  /** Local failure notice: shown to the user, never sent back as history. */
  error?: boolean;
}

export const MAX_HISTORY_TURNS = 6;
export const MAX_TURN_CHARS = 1000;
export const MAX_QUESTION_CHARS = 500;
export const MIN_QUESTION_CHARS = 3;

export interface AskPayload {
  question: string;
  mode: ChatMode;
  history: ChatTurn[];
}

export const chatApi = {
  async ask(payload: AskPayload, signal?: AbortSignal): Promise<ChatResponse> {
    const { data } = await appApi.post("/assistant/chat", payload, { signal });
    return data;
  },
};

/** The last turns the server may use as context (untrusted by the server, clipped to its limits). */
export function toHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => !message.error && message.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_TURN_CHARS) }));
}

interface HttpFailure {
  isAxiosError?: boolean;
  response?: { status?: number; data?: { detail?: unknown }; headers?: Record<string, unknown> };
}

const detailOf = (error: HttpFailure): string | null => {
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : null;
};

/** Maps an assistant request failure to a Spanish, user-safe message (never raw provider text). */
export function chatErrorMessage(error: unknown): string {
  const failure = (error ?? {}) as HttpFailure;
  if (!failure.isAxiosError) return "Ocurrió un error inesperado. Intentá de nuevo.";
  const status = failure.response?.status;
  if (status === undefined) return "No se pudo conectar con el servidor. Revisá tu conexión.";
  switch (status) {
    case 403:
      return "No tenés permiso para consultar datos de telemetría.";
    case 422:
      return detailOf(failure) ?? "No pude responder esa pregunta. Probá reformularla.";
    case 429: {
      const seconds = Number.parseInt(String(failure.response?.headers?.["retry-after"] ?? ""), 10);
      return Number.isFinite(seconds) && seconds > 0
        ? `Demasiadas consultas al asistente. Esperá ${seconds} ${seconds === 1 ? "segundo" : "segundos"} e intentá de nuevo.`
        : "Demasiadas consultas al asistente. Esperá un momento e intentá de nuevo.";
    }
    case 502:
      return "El proveedor de IA no pudo completar la solicitud. Probá de nuevo en un momento.";
    case 503:
      return detailOf(failure) ?? "El asistente no está disponible por ahora.";
    case 504:
      return detailOf(failure) ?? "La consulta tardó demasiado. Probá con una pregunta más acotada.";
    default:
      return "Ocurrió un error inesperado. Intentá de nuevo.";
  }
}
