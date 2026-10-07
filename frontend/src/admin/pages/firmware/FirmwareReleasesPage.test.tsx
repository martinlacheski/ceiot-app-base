import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FirmwarePage, FirmwareRelease } from "@/app/types/firmware.types";

import { FirmwareReleasesPage } from "./FirmwareReleasesPage";

const mocks = vi.hoisted(() => ({ pageReleases: vi.fn(), setReleaseActive: vi.fn(), confirm: vi.fn(), downloadReport: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/app/services/firmware.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/services/firmware.service")>()),
  firmwareService: { pageReleases: mocks.pageReleases, setReleaseActive: mocks.setReleaseActive },
}));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("@/lib/downloadReport", () => ({ downloadReport: mocks.downloadReport }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: (selector: (state: object) => unknown) => selector({ user: { isAdmin: true, permissions: [] } }) }));

const release = (overrides: Partial<FirmwareRelease> = {}): FirmwareRelease => ({
  id: "r1", version: "1.2.0", sha256: "a".repeat(64), size: 2_147_024, notes: "iot_device · compilado", createdAt: "2026-10-06T12:00:00", active: true, ...overrides,
});

const pageOf = (items: FirmwareRelease[], total = items.length): FirmwarePage => ({ items, total, pages: Math.max(1, Math.ceil(total / 10)), page: 1, perPage: 10 });

function renderPage() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><FirmwareReleasesPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pageReleases.mockResolvedValue(pageOf([release()]));
});

describe("FirmwareReleasesPage", () => {
  it("follows the list standard: title, primary create button, columns and footer", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Firmware" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo firmware" })).toHaveAttribute("href", "/admin/firmware/create");
    expect(screen.getByRole("link", { name: "Nuevo firmware" })).toHaveClass("h-11");
    const table = await screen.findByTestId("firmware-table");
    await within(table).findByText("1.2.0");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(
      expect.arrayContaining(["Versión", "Tamaño", "Notas", "Subido", "Estado", "Acciones"]));
    expect(within(table).getByText("2,1 MB")).toBeInTheDocument();
    expect(within(table).getByText("Activo")).toBeInTheDocument();
    expect(within(table).getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByText("Familia")).toBeNull();
    expect(screen.queryByText("Sin OTA")).toBeNull();
    expect(screen.getByText("1 firmware en total")).toBeInTheDocument();
  });

  it("shows one card per release for small screens", async () => {
    renderPage();
    const cards = await screen.findByTestId("firmware-cards");
    expect(await within(cards).findByText("1.2.0")).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: "Desactivar 1.2.0" })).toBeInTheDocument();
  });

  it("queries the server sorted by newest first and applies search and status", async () => {
    renderPage();
    await waitFor(() => expect(mocks.pageReleases).toHaveBeenCalled());
    expect(mocks.pageReleases.mock.calls[0][0]).toEqual({ page: 1, perPage: 10, search: undefined, active: undefined, sort: "createdAt:desc" });
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
    await waitFor(() => expect(mocks.pageReleases.mock.calls.at(-1)![0]).toMatchObject({ active: false }));
    fireEvent.change(screen.getByPlaceholderText("Buscar en todos los campos..."), { target: { value: "1.2" } });
    await waitFor(() => expect(mocks.pageReleases.mock.calls.at(-1)![0]).toMatchObject({ search: "1.2" }));
    for (const title of ["Versión", "Subido"]) expect(within(screen.getByTestId("firmware-table")).getByRole("button", { name: title })).toBeInTheDocument();
  });

  it("asks for confirmation before deactivating or activating a release", async () => {
    mocks.pageReleases.mockResolvedValue(pageOf([release(), release({ id: "r0", version: "1.1.0", active: false })]));
    mocks.setReleaseActive.mockResolvedValue(release());
    renderPage();
    const table = await screen.findByTestId("firmware-table");
    fireEvent.click(await within(table).findByRole("button", { name: "Desactivar 1.2.0" }));
    expect(mocks.confirm).toHaveBeenCalledWith("¿Desactivar el firmware 1.2.0?", expect.any(Function));
    await mocks.confirm.mock.calls[0][1]();
    expect(mocks.setReleaseActive).toHaveBeenCalledWith("r1", false);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Firmware desactivado");
    fireEvent.click(within(table).getByRole("button", { name: "Activar 1.1.0" }));
    await mocks.confirm.mock.calls[1][1]();
    expect(mocks.setReleaseActive).toHaveBeenCalledWith("r0", true);
  });

  it("shows the backend reason when the status change fails", async () => {
    mocks.setReleaseActive.mockRejectedValue({ response: { status: 404, data: { detail: "Firmware no encontrado" } } });
    renderPage();
    const table = await screen.findByTestId("firmware-table");
    fireEvent.click(await within(table).findByRole("button", { name: "Desactivar 1.2.0" }));
    await mocks.confirm.mock.calls[0][1]();
    expect(mocks.toastError).toHaveBeenCalledWith("Firmware no encontrado");
  });

  it("exports every filtered row", async () => {
    renderPage();
    await within(await screen.findByTestId("firmware-table")).findByText("1.2.0");
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(mocks.downloadReport).toHaveBeenCalled());
    const [format, report] = mocks.downloadReport.mock.calls[0];
    expect(format).toBe("excel");
    expect(report.title).toBe("Reporte de Firmware");
    expect(report.columns).toEqual(["Versión", "Tamaño", "Notas", "Subido", "Estado"]);
    expect(report.data[0]).toEqual(["1.2.0", "2,1 MB", "iot_device · compilado", expect.stringMatching(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/), "Activo"]);
  });
});
