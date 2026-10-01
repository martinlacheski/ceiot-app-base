import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadDocumentDialog } from "./UploadDocumentDialog";
import { documentsApi } from "./documentsApi";

vi.mock("./documentsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./documentsApi")>()),
  documentsApi: { upload: vi.fn() },
}));

const file = (name: string, size = 5) => new File([new Uint8Array(size)], name);

function setup() {
  const onUploaded = vi.fn();
  const onOpenChange = vi.fn();
  render(<UploadDocumentDialog open onOpenChange={onOpenChange} onUploaded={onUploaded} />);
  return { onUploaded, onOpenChange, input: screen.getByLabelText("Archivos a subir") as HTMLInputElement };
}

beforeEach(() => vi.clearAllMocks());

describe("UploadDocumentDialog", () => {
  it("validates type and size client-side and blocks the upload of invalid files", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { files: [file("virus.exe"), file("big.txt", 21 * 1024 * 1024)] } });
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual([
      expect.stringContaining("Formato no permitido"),
      expect.stringContaining("20 MB"),
    ]);
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
  });

  it("accepts dropped files and uploads them in order with progress, then notifies once", async () => {
    vi.mocked(documentsApi.upload).mockImplementation(async (_file, onProgress) => {
      onProgress?.(40);
      return {} as never;
    });
    const { onUploaded } = setup();
    fireEvent.drop(screen.getByTestId("document-dropzone"), { dataTransfer: { files: [file("a.txt"), file("b.md")] } });
    expect(screen.getByRole("button", { name: "Subir (2)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Subir (2)" }));
    await waitFor(() => expect(screen.getAllByText("Subido correctamente.")).toHaveLength(2));
    expect(vi.mocked(documentsApi.upload).mock.calls.map(([f]) => f.name)).toEqual(["a.txt", "b.md"]);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("shows the server error per file (duplicate) and keeps uploading the rest", async () => {
    vi.mocked(documentsApi.upload)
      .mockRejectedValueOnce({ response: { data: { detail: "Ya existe un documento con el mismo contenido" } } })
      .mockResolvedValueOnce({} as never);
    const { onUploaded } = setup();
    fireEvent.change(screen.getByLabelText("Archivos a subir"), { target: { files: [file("a.txt"), file("b.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir (2)" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ya existe un documento con el mismo contenido"));
    await waitFor(() => expect(screen.getByText("Subido correctamente.")).toBeInTheDocument());
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("shows a progressbar while uploading", async () => {
    let finish: () => void = () => {};
    vi.mocked(documentsApi.upload).mockImplementation((_file, onProgress) => {
      onProgress?.(60);
      return new Promise((resolve) => { finish = () => resolve({} as never); });
    });
    setup();
    fireEvent.change(screen.getByLabelText("Archivos a subir"), { target: { files: [file("a.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir (1)" }));
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByText("Subido correctamente.")).toBeInTheDocument());
  });
});
