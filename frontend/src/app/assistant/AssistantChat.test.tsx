import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/auth/store/auth.store";
import { AssistantChat } from "./AssistantChat";
import { chatApi, type ChatResponse } from "./chatApi";

vi.mock("./chatApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chatApi")>()),
  chatApi: { ask: vi.fn() },
}));

const response = (overrides: Partial<ChatResponse> = {}): ChatResponse => ({
  answer: "La temperatura promedio fue 21,5 °C.",
  route: { datos: true, documentos: false, mode: "auto" },
  sql: {
    query: "SELECT AVG(value) AS promedio FROM ai_read.telemetry LIMIT 1",
    columns: ["dia", "promedio"],
    rows: [{ dia: "2026-10-01", promedio: 21.5 }],
    truncated: false,
  },
  sources: [],
  trace: [],
  warnings: [],
  ...overrides,
});

const setUser = (overrides: { id?: string; isAdmin?: boolean; permissions?: string[] } = {}) =>
  useAuthStore.setState({
    user: { id: "u1", isAdmin: false, permissions: ["telemetry:read"], ...overrides } as never,
  });

const openChat = () => fireEvent.click(screen.getByRole("button", { name: "Asistente" }));
const box = () => screen.getByRole("textbox", { name: "Pregunta" });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setUser();
});
afterEach(() => useAuthStore.setState({ user: null }));

describe("AssistantChat", () => {
  it("opens from the floating 44px button, closes with Escape and keeps a labelled dialog", async () => {
    render(<AssistantChat />);
    expect(screen.getByRole("button", { name: "Asistente" })).toHaveClass("h-11");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openChat();
    expect(screen.getByRole("dialog", { name: "Asistente" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers example questions that send immediately", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(response());
    render(<AssistantChat />);
    openChat();
    fireEvent.click(screen.getByRole("button", { name: "¿Qué precisión tiene el DHT22?" }));
    await screen.findByText("La temperatura promedio fue 21,5 °C.");
    expect(vi.mocked(chatApi.ask).mock.calls[0][0]).toMatchObject({
      question: "¿Qué precisión tiene el DHT22?",
      mode: "auto",
      history: [],
    });
  });

  it("sends with Enter, keeps Shift+Enter as a newline and ignores short questions", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(response());
    render(<AssistantChat />);
    openChat();
    type("ab");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    type("¿Y la humedad?");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(chatApi.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    await screen.findByText("La temperatura promedio fue 21,5 °C.");
    expect(chatApi.ask).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue("");
  });

  it("renders the data table, sources with relevance and warnings; SQL only for admins", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(
      response({
        sources: [{ documentId: "d1", title: "Hoja DHT22", page: 2, section: null, distance: 0.3, excerpt: "±0,5 °C" }],
        warnings: ["No pude responder la parte de datos de la pregunta."],
      }),
    );
    const { unmount } = render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    await screen.findByText("La temperatura promedio fue 21,5 °C.");
    const table = screen.getByRole("table");
    expect(within(table).getByText("promedio")).toBeInTheDocument();
    expect(within(table).getByText("21.5")).toBeInTheDocument();
    expect(screen.getByText(/Hoja DHT22/)).toBeInTheDocument();
    expect(screen.getByText(/p\. 2/)).toBeInTheDocument();
    expect(screen.getByText(/relevancia 70 %/i)).toBeInTheDocument();
    expect(screen.getByText("No pude responder la parte de datos de la pregunta.")).toBeInTheDocument();
    expect(screen.queryByText(/SELECT AVG/)).not.toBeInTheDocument();
    unmount();

    sessionStorage.clear();
    setUser({ isAdmin: true });
    vi.mocked(chatApi.ask).mockResolvedValue(response());
    render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    expect(await screen.findByText(/SELECT AVG/)).toBeInTheDocument();
  });

  it("renders model output as plain text, never as HTML", async () => {
    const evil = '<img src=x onerror="window.__pwned = 1"> <script>window.__pwned = 2</script>';
    vi.mocked(chatApi.ask).mockResolvedValue(
      response({
        answer: evil,
        sql: { query: evil, columns: ["c"], rows: [{ c: evil }], truncated: false },
        sources: [{ documentId: "d", title: evil, page: null, section: evil, distance: 0.2, excerpt: evil }],
        warnings: [evil],
      }),
    );
    render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    await waitFor(() => expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("maps request failures to Spanish messages announced as alerts", async () => {
    vi.mocked(chatApi.ask).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: { detail: "x" }, headers: { "retry-after": "12" } },
    });
    render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent(/12 segundos/);
  });

  it("shows 'Asistente no configurado' when the server answers 503", async () => {
    vi.mocked(chatApi.ask).mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { detail: "Asistente no configurado" }, headers: {} },
    });
    render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("Asistente no configurado");
  });

  it("sends the selected mode as an override and disables datos without telemetry:read", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(response());
    const { unmount } = render(<AssistantChat />);
    openChat();
    const group = screen.getByRole("group", { name: "Modo" });
    expect(within(group).getByRole("button", { name: "Automático" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Documentos" }));
    type("pregunta de ejemplo");
    send();
    await screen.findByText("La temperatura promedio fue 21,5 °C.");
    expect(vi.mocked(chatApi.ask).mock.calls[0][0].mode).toBe("documentos");
    unmount();

    setUser({ permissions: [] });
    render(<AssistantChat />);
    openChat();
    expect(screen.getByRole("button", { name: "Datos" })).toBeDisabled();
  });

  it("sends only the last 6 turns as history", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(response({ answer: "respuesta" }));
    render(<AssistantChat />);
    openChat();
    for (let i = 1; i <= 5; i += 1) {
      type(`pregunta número ${i}`);
      send();
      await waitFor(() => expect(screen.getAllByText("respuesta")).toHaveLength(i));
    }
    type("pregunta final");
    send();
    await waitFor(() => expect(chatApi.ask).toHaveBeenCalledTimes(6));
    const { history } = vi.mocked(chatApi.ask).mock.calls[5][0];
    expect(history).toHaveLength(6);
    expect(history[0]).toEqual({ role: "user", content: "pregunta número 3" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "respuesta" });
  });

  it("discards a stale response when a newer question was sent", async () => {
    let resolveFirst: (value: ChatResponse) => void = () => {};
    vi.mocked(chatApi.ask)
      .mockImplementationOnce(() => new Promise<ChatResponse>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(response({ answer: "segunda respuesta" }));
    render(<AssistantChat />);
    openChat();
    type("primera pregunta");
    send();
    type("segunda pregunta");
    send();
    await screen.findByText("segunda respuesta");
    await act(async () => resolveFirst(response({ answer: "primera respuesta" })));
    expect(screen.queryByText("primera respuesta")).not.toBeInTheDocument();
  });

  it("starts a new conversation and persists history per user in sessionStorage", async () => {
    vi.mocked(chatApi.ask).mockResolvedValue(response({ answer: "respuesta guardada" }));
    const { unmount } = render(<AssistantChat />);
    openChat();
    type("pregunta de ejemplo");
    send();
    await screen.findByText("respuesta guardada");
    unmount();

    render(<AssistantChat />);
    openChat();
    expect(screen.getByText("respuesta guardada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    expect(screen.queryByText("respuesta guardada")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("assistant-chat:u1")).toBeNull();
  });

  it("does not show another user's stored conversation", () => {
    sessionStorage.setItem(
      "assistant-chat:u2",
      JSON.stringify([{ id: "1", role: "assistant", content: "secreto de otro" }]),
    );
    render(<AssistantChat />);
    openChat();
    expect(screen.queryByText("secreto de otro")).not.toBeInTheDocument();
  });

  it("announces new answers through a polite live region", () => {
    render(<AssistantChat />);
    openChat();
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });
});
