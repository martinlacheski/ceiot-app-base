import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceTypeListPage } from "./DeviceTypeListPage";

const mocks = vi.hoisted(() => ({ list: vi.fn(), deactivate: vi.fn(), update: vi.fn(), getCatalog: vi.fn(), confirm: vi.fn(), downloadReport: vi.fn() }));
vi.mock("./deviceTypesApi", () => ({ deviceTypesApi: { list: mocks.list, deactivate: mocks.deactivate, update: mocks.update } }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: { getCatalog: mocks.getCatalog } }));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("@/lib/downloadReport", () => ({ downloadReport: mocks.downloadReport }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: (selector: (state: object) => unknown) => selector({ user: { isAdmin: true, permissions: [] } }) }));

const row = (patch = {}) => ({ id: "t1", code: "environmental", name: "Ambiental", description: null, hardwareModel: "ESP32-DevKit", telemetryIntervalS: 60, offlineAfterS: 180, minSensors: 1, configTemplate: {}, isActive: true,
  sensors: [{ sensorId: "s1", code: "dht22", name: "DHT22", manufacturer: "Aosong", isActive: true, required: false, maxCount: 2, includedByDefault: false, variables: [] }, { sensorId: "s2", code: "bme280", name: "BME280", manufacturer: "Bosch", isActive: true, required: false, maxCount: 2, includedByDefault: true, variables: [] }], ...patch });

function renderList() {
  mocks.list.mockResolvedValue({ items: [row(), row({ id: "t2", code: "relay", name: "Relés", isActive: false, sensors: [], hardwareModel: null, telemetryIntervalS: null, offlineAfterS: null, minSensors: 0 })], total: 2, page: 1, perPage: 10, pages: 1 });
  mocks.getCatalog.mockResolvedValue([{ id: "s1", code: "dht22", name: "DHT22", manufacturer: "Aosong", variables: [] }]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DeviceTypeListPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("device type list", () => {
  it("follows the list standard: title, primary create button, columns and icon actions", async () => {
    renderList();
    expect(screen.getByRole("heading", { name: "Tipos de dispositivo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo tipo de dispositivo" })).toHaveClass("h-11");
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Editar tipo de dispositivo" }).length).toBe(2));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(
      expect.arrayContaining(["Código", "Nombre", "Modelo de placa", "Sensores compatibles", "Intervalo (s)", "Sin conexión (s)", "Mín. sensores", "Estado", "Acciones"]));
    expect(screen.getByText("DHT22, BME280")).toBeInTheDocument();
    const edit = screen.getAllByRole("link", { name: "Editar tipo de dispositivo" })[0];
    expect(edit).toHaveAttribute("href", "/admin/device-types/edit/t1");
    expect(edit.querySelector(".lucide-square-pen, .lucide-pen-box")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Desactivar tipo de dispositivo" }).querySelector(".lucide-trash-2, .lucide-trash2")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Activar tipo de dispositivo" }).querySelector(".lucide-rotate-cw")).not.toBeNull();
  });

  it("queries the server with search, sort, filters and the default status", async () => {
    renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.list.mock.calls[0][0]).toMatchObject({ page: 1, perPage: 10, sort: "name:asc", status: "all" });
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByLabelText("Estado")).toBeInTheDocument();
    expect(screen.getByLabelText("Modelo de placa", { selector: "input" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Sensor compatible")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
    await waitFor(() => expect(mocks.list.mock.calls.at(-1)![0]).toMatchObject({ status: "inactive" }));
    fireEvent.change(screen.getByPlaceholderText("Buscar en todos los campos..."), { target: { value: "esp32" } });
    await waitFor(() => expect(mocks.list.mock.calls.at(-1)![0]).toMatchObject({ search: "esp32" }));
    for (const title of ["Código", "Nombre", "Modelo de placa", "Sensores compatibles", "Intervalo (s)", "Sin conexión (s)", "Mín. sensores", "Estado"]) expect(within(screen.getByRole("table")).getByRole("button", { name: title })).toBeInTheDocument();
  });

  it("asks for confirmation before deactivating and reactivates through update", async () => {
    renderList();
    await waitFor(() => expect(screen.getByRole("button", { name: "Desactivar tipo de dispositivo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Desactivar tipo de dispositivo" }));
    expect(mocks.confirm).toHaveBeenCalledWith("¿Desactivar Ambiental?", expect.any(Function));
    await mocks.confirm.mock.calls[0][1]();
    expect(mocks.deactivate).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByRole("button", { name: "Activar tipo de dispositivo" }));
    await mocks.confirm.mock.calls[1][1]();
    expect(mocks.update).toHaveBeenCalledWith("t2", { isActive: true });
  });

  it("exports every filtered row with branded columns", async () => {
    renderList();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Editar tipo de dispositivo" }).length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(mocks.downloadReport).toHaveBeenCalled());
    const [format, report] = mocks.downloadReport.mock.calls[0];
    expect(format).toBe("excel");
    expect(report.title).toBe("Reporte de Tipos de dispositivo");
    expect(report.columns).toEqual(["Código", "Nombre", "Modelo de placa", "Sensores compatibles", "Intervalo (s)", "Sin conexión (s)", "Mín. sensores", "Estado"]);
    expect(report.data[0]).toEqual(["environmental", "Ambiental", "ESP32-DevKit", "DHT22, BME280", "60", "180", "1", "Activo"]);
    expect(report.data[1]).toEqual(["relay", "Relés", "", "", "", "", "0", "Inactivo"]);
  });
});
