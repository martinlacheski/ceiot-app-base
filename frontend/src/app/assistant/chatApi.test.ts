import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { chatErrorMessage, chatApi, toHistory, type ChatMessage } from "./chatApi";

vi.mock("@/api/appApi", () => ({ appApi: { post: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const failure = (status: number, detail?: unknown, headers: Record<string, string> = {}) => ({
  isAxiosError: true,
  response: { status, data: detail === undefined ? {} : { detail }, headers },
});

describe("chatApi.ask", () => {
  it("posts the question, mode and history and forwards the abort signal", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: { answer: "ok" } });
    const controller = new AbortController();
    const history = [{ role: "user" as const, content: "hola" }];
    await chatApi.ask({ question: "¿pregunta?", mode: "datos", history }, controller.signal);
    expect(appApi.post).toHaveBeenCalledWith(
      "/assistant/chat",
      { question: "¿pregunta?", mode: "datos", history },
      { signal: controller.signal },
    );
  });
});

describe("chatErrorMessage", () => {
  it("uses the server's Spanish detail for 422 and falls back when absent", () => {
    expect(chatErrorMessage(failure(422, "No puedo responder esa pregunta con los datos disponibles."))).toBe(
      "No puedo responder esa pregunta con los datos disponibles.",
    );
    expect(chatErrorMessage(failure(422))).toMatch(/No pude responder/);
  });

  it("tells how long to wait on 429", () => {
    expect(chatErrorMessage(failure(429, "x", { "retry-after": "17" }))).toMatch(/17 segundos/);
    expect(chatErrorMessage(failure(429, "x", { "retry-after": "1" }))).toMatch(/1 segundo\b/);
    expect(chatErrorMessage(failure(429, "x"))).toMatch(/Demasiadas consultas/);
  });

  it("maps provider, availability and timeout statuses", () => {
    expect(chatErrorMessage(failure(502, "x"))).toMatch(/proveedor de IA/);
    expect(chatErrorMessage(failure(503, "Asistente no configurado"))).toBe("Asistente no configurado");
    expect(chatErrorMessage(failure(503))).toMatch(/no está disponible/);
    expect(chatErrorMessage(failure(504, "La consulta tardó demasiado; acotá el período."))).toMatch(/tardó demasiado/);
    expect(chatErrorMessage(failure(403))).toMatch(/permiso/);
  });

  it("handles network failures and unknown errors", () => {
    expect(chatErrorMessage({ isAxiosError: true, response: undefined })).toMatch(/conectar/);
    expect(chatErrorMessage(new Error("boom"))).toMatch(/Ocurrió un error/);
  });
});

describe("toHistory", () => {
  const msg = (i: number, role: "user" | "assistant", extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: String(i),
    role,
    content: `m${i}`,
    ...extra,
  });

  it("keeps only the last 6 turns, skipping errors and clipping long content", () => {
    const messages = [
      ...Array.from({ length: 8 }, (_, i) => msg(i, i % 2 ? "assistant" : "user")),
      msg(8, "assistant", { error: true, content: "fallo" }),
      msg(9, "user", { content: "x".repeat(1500) }),
    ];
    const history = toHistory(messages);
    expect(history).toHaveLength(6);
    expect(history.slice(0, 2).map((t) => t.content)).toEqual(["m3", "m4"]);
    expect(history.some((t) => t.content === "fallo")).toBe(false);
    expect(history.at(-1)?.content).toHaveLength(1000);
  });
});
