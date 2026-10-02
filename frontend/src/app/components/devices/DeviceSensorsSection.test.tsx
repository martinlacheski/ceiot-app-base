import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceSensorsSection } from "./DeviceSensorsSection";

const mocks = vi.hoisted(() => ({ getTypes: vi.fn(), getCatalog: vi.fn(), getDeviceSensors: vi.fn(), addDeviceSensor: vi.fn(), updateDeviceSensor: vi.fn(), removeDeviceSensor: vi.fn(), confirm: vi.fn() }));
const auth = vi.hoisted(() => ({ permissions: ["sensor_catalog:read", "device_sensor:read", "device_sensor:write"] }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: mocks }));
vi.mock("@/app/services/device.service", () => ({ deviceService: { getTypes: mocks.getTypes } }));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: () => ({ user: { id: "owner", permissions: auth.permissions, isAdmin: false } }) }));

const catalog = [{ id: "model-1", code: "dht22", name: "DHT22", manufacturer: "Aosong", variables: [{ code: "temperature", name: "Temperatura", unit: "°C", min: -40.5, max: 80.5, accuracy: "±0.5", resolution: "0.1" }] }];
const installed = [{ id: "installed-1", deviceId: "device-1", sensorId: "model-1", key: "dht22", config: {}, isActive: true, installedAt: "2026-09-21T12:00:00Z", removedAt: null }];

function renderSection(canManage = true, deviceTypeId?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DeviceSensorsSection deviceId="device-1" canManage={canManage} deviceTypeId={deviceTypeId} /></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); auth.permissions = ["sensor_catalog:read", "device_sensor:read", "device_sensor:write"]; mocks.getCatalog.mockResolvedValue(catalog); mocks.getDeviceSensors.mockResolvedValue(installed); mocks.addDeviceSensor.mockResolvedValue(installed[0]); mocks.updateDeviceSensor.mockResolvedValue(installed[0]); mocks.removeDeviceSensor.mockResolvedValue(installed[0]); });

describe("DeviceSensorsSection", () => {
  it("shows model variables, range, key, installation and active status", async () => {
    renderSection();
    expect((await screen.findAllByText("DHT22")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Sensor", "Variables", "Instalado", "Acciones"]);
    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("button", { name: "Agregar sensor" }).compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar sensor" })).toHaveAttribute("title", "Quitar sensor");
    expect(screen.getByText(/Temperatura.*°C.*-40,5.*80,5/)).toBeInTheDocument();
    expect(screen.getByText("Identificador en telemetría")).toBeInTheDocument();
    expect(screen.getByText("dht22")).toBeInTheDocument();
    expect(screen.getByText(/nombre que usa el dispositivo en su telemetría/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/clave/i)).not.toBeInTheDocument();
  });
  it("adds with an omitted key and confirms deactivation", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText("DHT22");
    await user.selectOptions(screen.getByLabelText("Modelo de sensor"), "model-1");
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await waitFor(() => expect(mocks.addDeviceSensor).toHaveBeenCalledWith("device-1", { sensorId: "model-1", config: {} }));
    await user.click(screen.getByRole("button", { name: "Quitar sensor" }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining("quitar"), expect.any(Function));
    await mocks.confirm.mock.calls[0][1]();
    await waitFor(() => expect(mocks.removeDeviceSensor).toHaveBeenCalledWith("device-1", "installed-1"));
  });
  it("updates JSON configuration without editing or patching the key", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText("DHT22");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.queryByLabelText(/clave/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Configuración JSON"), { target: { value: '{"offset":1}' } });
    await user.click(screen.getByRole("button", { name: "Guardar sensor" }));
    await waitFor(() => expect(mocks.updateDeviceSensor).toHaveBeenCalledWith("device-1", "installed-1", { config: { offset: 1 } }));
  });
  it("hides mutations without ownership", async () => {
    renderSection(false);
    await screen.findAllByText("DHT22");
    expect(screen.queryByRole("button", { name: "Agregar sensor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar sensor" })).not.toBeInTheDocument();
  });
  it("does not request or render device sensors without read permission", () => {
    auth.permissions = [];
    renderSection();
    expect(screen.queryByText("Sensores del dispositivo")).not.toBeInTheDocument();
    expect(mocks.getDeviceSensors).not.toHaveBeenCalled();
  });
  it("renders read-only without write permission", async () => {
    auth.permissions = ["sensor_catalog:read", "device_sensor:read"];
    renderSection();
    await screen.findAllByText("DHT22");
    expect(screen.queryByRole("button", { name: "Agregar sensor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar sensor" })).not.toBeInTheDocument();
  });
  it("shows an empty table row when no sensors are installed", async () => {
    mocks.getDeviceSensors.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("Todavía no agregaste sensores.")).toBeInTheDocument();
    expect(screen.getByRole("table")).toContainElement(screen.getByText("Todavía no agregaste sensores."));
  });
});

describe("DeviceSensorsSection with a device type", () => {
  const link = (sensorId: string, name: string, maxCount: number) => ({ sensorId, code: name.toLowerCase(), name, manufacturer: "X", isActive: true, required: false, maxCount, includedByDefault: false, variables: [] });
  beforeEach(() => {
    mocks.getCatalog.mockResolvedValue([...catalog, { id: "model-2", code: "bmp280", name: "BMP280", manufacturer: "Bosch", variables: [] }, { id: "model-3", code: "bme280", name: "BME280", manufacturer: "Bosch", variables: [] }]);
    mocks.getTypes.mockResolvedValue({ items: [{ id: "type-1", name: "Ambiental", isActive: true, minSensors: 1, sensors: [link("model-1", "DHT22", 1), link("model-3", "BME280", 2)] }], total: 1, page: 1, perPage: 100, pages: 1 });
  });
  it("offers only the compatible models that are below their maximum", async () => {
    renderSection(true, "type-1");
    await screen.findAllByText("DHT22");
    const select = screen.getByLabelText("Modelo de sensor");
    // BMP280 is not compatible; DHT22 (max 1) is already installed; only BME280 remains.
    await waitFor(() => expect(Array.from(select.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["Seleccionar modelo", "BME280"]));
  });
  it("shows the server's reason when adding is refused", async () => {
    const user = userEvent.setup();
    mocks.addDeviceSensor.mockRejectedValue({ response: { data: { detail: "El tipo «Ambiental» admite como máximo 1 sensor(es) DHT22" } } });
    renderSection(true);
    await screen.findAllByText("DHT22");
    await user.selectOptions(screen.getByLabelText("Modelo de sensor"), "model-1");
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("admite como máximo 1 sensor(es) DHT22");
  });
});
