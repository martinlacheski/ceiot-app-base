import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { firmwareUpdatePollInterval, type FirmwareRelease, type FirmwareUpdate } from "@/app/types/firmware.types";

import { DeviceFirmwareSection } from "./DeviceFirmwareSection";

const mocks = vi.hoisted(() => ({ listReleases: vi.fn(), listUpdates: vi.fn(), startUpdate: vi.fn(), confirm: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/app/services/firmware.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/services/firmware.service")>()),
  firmwareService: { listReleases: mocks.listReleases, listUpdates: mocks.listUpdates, startUpdate: mocks.startUpdate },
}));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

const release = (version: string, id = `r-${version}`): FirmwareRelease => ({ id, version, sha256: "a".repeat(64), size: 1000, createdAt: "2026-10-06T12:00:00", active: true });
const attempt = (overrides: Partial<FirmwareUpdate> = {}): FirmwareUpdate => ({
  id: "u1", requestId: "req-1", deviceId: "d1", deviceSerial: "IOT-1", releaseId: "r-1.3.0", state: "downloading", progress: 40,
  targetVersion: "1.3.0", runningVersion: "1.2.0", createdAt: "2026-10-07T12:00:00", ...overrides,
});

const device = { id: "d1", brokerConnected: true as boolean | null, firmwareVersion: "1.2.0" as string | null };

function renderSection(props: Partial<typeof device> = {}) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeviceFirmwareSection device={{ ...device, ...props }} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listReleases.mockResolvedValue([release("1.3.0"), release("1.2.0")]);
  mocks.listUpdates.mockResolvedValue([]);
});

describe("DeviceFirmwareSection", () => {
  it("shows the current version, defaults to the newest active release and starts the update after confirming", async () => {
    mocks.startUpdate.mockResolvedValue(attempt({ state: "requested", progress: null }));
    renderSection();
    expect(screen.getByText("1.2.0", { selector: "span" })).toBeInTheDocument();
    const select = await screen.findByLabelText("Versión a instalar");
    await waitFor(() => expect(select).toHaveValue("r-1.3.0"));
    expect(mocks.listReleases).toHaveBeenCalledWith({ active: true });

    fireEvent.click(screen.getByRole("button", { name: "Actualizar firmware" }));
    expect(mocks.confirm).toHaveBeenCalledWith("¿Actualizar el firmware del dispositivo de la versión 1.2.0 a la 1.3.0?", expect.any(Function));
    await mocks.confirm.mock.calls[0][1]();
    expect(mocks.startUpdate).toHaveBeenCalledWith({ deviceId: "d1", releaseId: "r-1.3.0" });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Actualización de firmware solicitada"));
  });

  it("disables the update when the chosen release is the version the device already runs", async () => {
    renderSection();
    const select = await screen.findByLabelText("Versión a instalar");
    await waitFor(() => expect(select).toHaveValue("r-1.3.0"));
    fireEvent.change(select, { target: { value: "r-1.2.0" } });
    expect(screen.getByRole("button", { name: "Actualizar firmware" })).toBeDisabled();
    expect(screen.getByText("El dispositivo ya tiene esta versión.")).toBeInTheDocument();
  });

  it("disables the update while the device is offline", async () => {
    renderSection({ brokerConnected: false });
    await waitFor(() => expect(screen.getByLabelText("Versión a instalar")).toHaveValue("r-1.3.0"));
    expect(screen.getByRole("button", { name: "Actualizar firmware" })).toBeDisabled();
    expect(screen.getByText("El dispositivo está sin conexión.")).toBeInTheDocument();
  });

  it("shows the latest attempt with its progress and blocks a new one while it runs", async () => {
    mocks.listUpdates.mockResolvedValue([attempt()]);
    renderSection();
    const status = await screen.findByTestId("firmware-latest-attempt");
    expect(within(status).getByText("Descargando")).toBeInTheDocument();
    expect(within(status).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("button", { name: "Actualizar firmware" })).toBeDisabled();
  });

  it("shows the interrupted message and lists the device's attempts", async () => {
    mocks.listUpdates.mockResolvedValue([
      attempt({ id: "u2", state: "failed", progress: null, errorCode: "interrupted", errorMessage: "El dispositivo se desconectó durante la actualización. No se cambió nada." }),
      attempt({ id: "u1", state: "succeeded", progress: 100, targetVersion: "1.2.0", createdAt: "2026-10-01T12:00:00" }),
    ]);
    renderSection();
    const status = await screen.findByTestId("firmware-latest-attempt");
    expect(within(status).getByText("Fallida")).toBeInTheDocument();
    expect(within(status).getByText("El dispositivo se desconectó durante la actualización. No se cambió nada.")).toBeInTheDocument();
    const history = screen.getByRole("table");
    expect(within(history).getAllByRole("row")).toHaveLength(3);
    expect(within(history).getByText("Completada")).toBeInTheDocument();
  });

  it("shows the backend reason when the update cannot start", async () => {
    mocks.startUpdate.mockRejectedValue({ response: { status: 409, data: { detail: "Ya hay una actualización en curso para este dispositivo" } } });
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Versión a instalar")).toHaveValue("r-1.3.0"));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar firmware" }));
    await mocks.confirm.mock.calls[0][1]();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Ya hay una actualización en curso para este dispositivo"));
  });

  it("explains when there is no active firmware to install", async () => {
    mocks.listReleases.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("No hay versiones de firmware activas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar firmware" })).toBeDisabled();
  });
});

describe("firmwareUpdatePollInterval", () => {
  it("polls while the latest attempt is not final and stops on final states", () => {
    expect(firmwareUpdatePollInterval(undefined)).toBe(false);
    expect(firmwareUpdatePollInterval([])).toBe(false);
    for (const state of ["requested", "accepted", "downloading", "verifying", "installing", "rebooting"] as const) {
      expect(firmwareUpdatePollInterval([attempt({ state })])).toBe(2000);
    }
    for (const state of ["succeeded", "failed", "rolled_back", "rejected"] as const) {
      expect(firmwareUpdatePollInterval([attempt({ state })])).toBe(false);
    }
  });
});
