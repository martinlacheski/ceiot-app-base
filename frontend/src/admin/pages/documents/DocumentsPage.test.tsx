import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConfirmStore } from "@/store/confirm.store";
import { DocumentsPage } from "./DocumentsPage";
import { documentsApi, type DocumentItem } from "./documentsApi";

vi.mock("./documentsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./documentsApi")>()),
  documentsApi: { list: vi.fn(), upload: vi.fn(), rename: vi.fn(), remove: vi.fn(), download: vi.fn(), ingest: vi.fn(), reindex: vi.fn() },
}));

const doc = (overrides: Partial<DocumentItem> = {}): DocumentItem => ({
  id: "d1", title: "Manual", filename: "manual.pdf", contentType: "application/pdf", sizeBytes: 1536,
  sha256: "a".repeat(64), uploadedBy: "u1", isActive: true, ingestionStatus: "pending", ingestedAt: null, error: null,
  chunkCount: 0, embeddingProvider: null, embeddingModel: null, needsReindex: false,
  createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", ...overrides,
});

function renderPage() {
  vi.mocked(documentsApi.list).mockResolvedValue({ items: [doc()], total: 1, page: 1, perPage: 10, pages: 1 });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter><DocumentsPage /></MemoryRouter></TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); useConfirmStore.setState({ isOpen: false }); });

describe("DocumentsPage", () => {
  it("lists documents with type, size, ingestion badge and 44px icon actions", async () => {
    renderPage();
    expect(await screen.findByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("manual.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("1,5 KB")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    for (const name of ["Reindexar", "Descargar", "Renombrar", "Eliminar"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-11");
    }
    expect(screen.getByRole("button", { name: "Subir documento" })).toHaveClass("h-11");
  });

  it("shows chunk count, embedding provider and the reindex warning", async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({
      items: [
        doc({ id: "a", title: "Listo", filename: "a.pdf", ingestionStatus: "ready", chunkCount: 12, embeddingProvider: "local", embeddingModel: "baai/bge-m3" }),
        doc({ id: "b", title: "Viejo", filename: "b.pdf", ingestionStatus: "ready", chunkCount: 3, embeddingProvider: "openrouter", embeddingModel: "baai/bge-m3", needsReindex: true }),
        doc({ id: "c", title: "Roto", filename: "c.pdf", ingestionStatus: "failed", error: "El PDF no contiene texto extraíble; no se aplica OCR." }),
      ],
      total: 3, page: 1, perPage: 10, pages: 1,
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter><DocumentsPage /></MemoryRouter></TooltipProvider></QueryClientProvider>);
    expect(await screen.findByText("12 fragmentos")).toBeInTheDocument();
    expect(screen.getByText("Local · bge-m3")).toBeInTheDocument();
    expect(screen.getAllByText("Requiere reindexar")).toHaveLength(1);
    expect(screen.getByText("El PDF no contiene texto extraíble; no se aplica OCR.")).toBeInTheDocument();
  });

  it("queues ingestion from the row action and refreshes", async () => {
    vi.mocked(documentsApi.ingest).mockResolvedValue(doc({ ingestionStatus: "processing" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reindexar" }));
    await waitFor(() => expect(documentsApi.ingest).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(documentsApi.list).toHaveBeenCalledTimes(2));
  });

  it("disables the row reindex while the document is processing", async () => {
    vi.mocked(documentsApi.list).mockResolvedValue({ items: [doc({ ingestionStatus: "processing" })], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter><DocumentsPage /></MemoryRouter></TooltipProvider></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "Reindexar" })).toBeDisabled();
  });

  it("queues every stale document from the toolbar", async () => {
    vi.mocked(documentsApi.reindex).mockResolvedValue({ queued: 2, documentIds: ["a", "b"] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reindexar desactualizados" }));
    await waitFor(() => expect(documentsApi.reindex).toHaveBeenCalledWith());
    await waitFor(() => expect(documentsApi.list).toHaveBeenCalledTimes(2));
  });

  it("requests the server with search, type and status filters and sort", async () => {
    renderPage();
    await screen.findByText("Manual");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "pdf" } });
    fireEvent.change(screen.getByLabelText("Estado de ingesta"), { target: { value: "failed" } });
    await waitFor(() => expect(documentsApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileType: "pdf", ingestionStatus: "failed", sort: "createdAt:desc", page: 1 })));
    const options = within(screen.getByLabelText("Estado de ingesta")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Todos", "Pendiente", "Procesando", "Listo", "Con error"]);
  });

  it("downloads through the API", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(documentsApi.download).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" })));
  });

  it("renames with validation and refreshes the list", async () => {
    vi.mocked(documentsApi.rename).mockResolvedValue(doc({ title: "Nuevo" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Renombrar" }));
    const input = await screen.findByLabelText("Título");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Nuevo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(documentsApi.rename).toHaveBeenCalledWith("d1", "Nuevo"));
    await waitFor(() => expect(documentsApi.list).toHaveBeenCalledTimes(2));
  });

  it("asks for confirmation before deleting and deletes only after confirming", async () => {
    vi.mocked(documentsApi.remove).mockResolvedValue();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    const state = useConfirmStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.message).toContain("Manual");
    expect(documentsApi.remove).not.toHaveBeenCalled();
    await state.onConfirm();
    expect(documentsApi.remove).toHaveBeenCalledWith("d1");
  });

  it("opens the upload dialog and refreshes after an upload", async () => {
    vi.mocked(documentsApi.upload).mockResolvedValue(doc());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Subir documento" }));
    expect(await screen.findByText("Subir documentos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Archivos a subir"), { target: { files: [new File(["x"], "n.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir (1)" }));
    await waitFor(() => expect(documentsApi.list).toHaveBeenCalledTimes(2));
  });

  it("shows an empty state", async () => {
    vi.mocked(documentsApi.list).mockResolvedValueOnce({ items: [], total: 0, page: 1, perPage: 10, pages: 0 });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider><MemoryRouter><DocumentsPage /></MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No hay documentos.")).toBeInTheDocument();
  });
});
