import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { firmwareService } from "@/app/services/firmware.service";
import type { FirmwareRelease } from "@/app/types/firmware.types";

import { CreateFirmwarePage } from "./CreateFirmwarePage";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/services/firmware.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/services/firmware.service")>()),
  firmwareService: { uploadRelease: vi.fn() },
}));

const created: FirmwareRelease = {
  id: "r1",
  version: "1.3.0",
  sha256: "a".repeat(64),
  size: 4,
  createdAt: "2026-10-06T12:00:00",
  active: true,
};

const SUMMARY = "iot_device · compilado 06/10/2026 14:32 · IDF v5.4";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/admin/firmware/create"]}>
        <Routes>
          <Route path="/admin/firmware" element={<p>Lista de firmwares</p>} />
          <Route path="/admin/firmware/create" element={<CreateFirmwarePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** A file whose first bytes are a real ESP app image head (`esp_app_desc_t` at offset 32). */
const firmwareFile = (project = "iot_device", version = "1.3.0", name = "iot_device.bin") => {
  const bytes = new Uint8Array(512);
  const put = (value: string, offset: number) => bytes.set(new TextEncoder().encode(value), offset);
  bytes[0] = 0xe9;
  new DataView(bytes.buffer).setUint32(32, 0xabcd5432, true);
  put(version, 48);
  put(project, 80);
  put("14:32:05", 112);
  put("Oct  6 2026", 128);
  put("v5.4", 144);
  return new File([bytes], name);
};

const pick = async (user: ReturnType<typeof userEvent.setup>, file: File) =>
  user.upload(screen.getByTestId("file-input-native"), file);

const waitForSummary = () =>
  waitFor(() => expect((screen.getByLabelText("Notas") as HTMLInputElement).value).toMatch(/compilado/));

describe("CreateFirmwarePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("follows the full-page form layout: title, back and actions", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Nuevo firmware" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Volver" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Subir firmware" })).toBeDisabled();
    expect(screen.getByLabelText("Archivo de firmware (.bin)")).toBeInTheDocument();
    expect(screen.getByLabelText("Versión")).toHaveAttribute("placeholder", "Se completa al elegir el archivo");
    expect(screen.getByLabelText("Notas")).toBeInTheDocument();
  });

  it("reads the version from the file, preloads the build summary and uploads without typing it", async () => {
    const user = userEvent.setup();
    vi.mocked(firmwareService.uploadRelease).mockResolvedValue(created);
    renderPage();
    const file = firmwareFile();

    await pick(user, file);

    await waitFor(() => expect(screen.getByLabelText("Notas")).toHaveValue(SUMMARY));
    expect(screen.getByText(SUMMARY, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByLabelText("Versión")).toHaveValue("1.3.0");
    expect(screen.getByLabelText("Versión")).toHaveAttribute("readonly");
    await user.type(screen.getByLabelText("Notas"), " · cambios");
    await user.click(screen.getByRole("button", { name: "Subir firmware" }));

    await waitFor(() =>
      expect(firmwareService.uploadRelease).toHaveBeenCalledWith({
        file,
        version: "1.3.0",
        notes: `${SUMMARY} · cambios`,
        deactivatePrevious: true,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Firmware 1.3.0 subido");
    expect(await screen.findByText("Lista de firmwares")).toBeInTheDocument();
  });

  it("rejects an image of another ESP-IDF project before uploading", async () => {
    const user = userEvent.setup();
    renderPage();

    await pick(user, firmwareFile("other_project", "9.9.9", "other.bin"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El archivo es del proyecto 'other_project', no del firmware de los dispositivos (iot_device)",
    );
    expect(screen.getByRole("button", { name: "Subir firmware" })).toBeDisabled();
  });

  it("rejects a file without an app descriptor", async () => {
    const user = userEvent.setup();
    renderPage();

    await pick(user, new File([new Uint8Array(512)], "x.bin"));

    expect(await screen.findByRole("alert")).toHaveTextContent("El archivo no es un firmware ESP32 válido");
    expect(screen.getByRole("button", { name: "Subir firmware" })).toBeDisabled();
  });

  it("rejects a file that is not .bin on the client", () => {
    renderPage();

    fireEvent.change(screen.getByTestId("file-input-native"), {
      target: { files: [new File([new Uint8Array([1])], "x.txt")] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(".bin");
    expect(screen.getByRole("button", { name: "Subir firmware" })).toBeDisabled();
  });

  it("shows the backend reason and stays on the screen", async () => {
    const user = userEvent.setup();
    vi.mocked(firmwareService.uploadRelease).mockRejectedValue({
      response: { status: 409, data: { detail: "Ya existe un firmware con esa versión" } },
    });
    renderPage();

    await pick(user, firmwareFile());
    await waitForSummary();
    await user.click(screen.getByRole("button", { name: "Subir firmware" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ya existe un firmware con esa versión"));
    expect(screen.getByRole("heading", { name: "Nuevo firmware" })).toBeInTheDocument();
  });

  it("goes back to the list with Volver", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole("button", { name: "Volver" })[1]);

    expect(await screen.findByText("Lista de firmwares")).toBeInTheDocument();
  });

  it("offers to deactivate the previous versions, checked by default, and sends the choice", async () => {
    const user = userEvent.setup();
    vi.mocked(firmwareService.uploadRelease).mockResolvedValue(created);
    renderPage();
    const checkbox = screen.getByRole("checkbox", { name: "Desactivar las versiones anteriores" });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    await pick(user, firmwareFile());
    await waitForSummary();
    await user.click(screen.getByRole("button", { name: "Subir firmware" }));

    await waitFor(() =>
      expect(firmwareService.uploadRelease).toHaveBeenCalledWith(expect.objectContaining({ deactivatePrevious: false })),
    );
  });

  it("tells in the toast how many previous versions were deactivated", async () => {
    const user = userEvent.setup();
    vi.mocked(firmwareService.uploadRelease).mockResolvedValue({ ...created, deactivatedPrevious: 2 });
    renderPage();

    await pick(user, firmwareFile());
    await waitForSummary();
    await user.click(screen.getByRole("button", { name: "Subir firmware" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Firmware 1.3.0 subido · 2 versiones anteriores desactivadas"),
    );
  });
});
