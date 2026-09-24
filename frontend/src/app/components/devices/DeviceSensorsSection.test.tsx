import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceSensorsSection } from "./DeviceSensorsSection";

const mocks = vi.hoisted(() => ({ getCatalog: vi.fn(), getDeviceSensors: vi.fn(), addDeviceSensor: vi.fn(), updateDeviceSensor: vi.fn(), removeDeviceSensor: vi.fn(), confirm: vi.fn() }));
const auth = vi.hoisted(() => ({ permissions: ["sensor_catalog:read", "device_sensor:read", "device_sensor:write"] }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: mocks }));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: () => ({ user: { id: "owner", permissions: auth.permissions, isAdmin: false } }) }));

const catalog = [{ id: "model-1", code: "dht22", name: "DHT22", manufacturer: "Aosong", variables: [{ code: "temperature", name: "Temperatura", unit: "°C", min: -40.5, max: 80.5, accuracy: "±0.5", resolution: "0.1" }] }];
const installed = [{ id: "installed-1", deviceId: "device-1", sensorId: "model-1", key: "dht22", config: {}, isActive: true, installedAt: "2026-09-21T12:00:00Z", removedAt: null }];

function renderSection(canManage = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DeviceSensorsSection deviceId="device-1" canManage={canManage} /></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); auth.permissions = ["sensor_catalog:read", "device_sensor:read", "device_sensor:write"]; mocks.getCatalog.mockResolvedValue(catalog); mocks.getDeviceSensors.mockResolvedValue(installed); mocks.addDeviceSensor.mockResolvedValue(installed[0]); mocks.updateDeviceSensor.mockResolvedValue(installed[0]); mocks.removeDeviceSensor.mockResolvedValue(installed[0]); });

describe("DeviceSensorsSection", () => {
  it("shows model variables, range, key, installation and active status", async () => {
    renderSection();
    expect(await screen.findByText("DHT22")).toBeInTheDocument();
    expect(screen.getByText(/Temperatura.*°C.*-40,5.*80,5/)).toBeInTheDocument();
    expect(screen.getByText(/dht22 · Activo/)).toBeInTheDocument();
  });
  it("adds with an omitted key and confirms deactivation", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("DHT22");
    await user.selectOptions(screen.getByLabelText("Modelo de sensor"), "model-1");
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await waitFor(() => expect(mocks.addDeviceSensor).toHaveBeenCalledWith("device-1", { sensorId: "model-1", config: {} }));
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining("quitar"), expect.any(Function));
    await mocks.confirm.mock.calls[0][1]();
    await waitFor(() => expect(mocks.removeDeviceSensor).toHaveBeenCalledWith("device-1", "installed-1"));
  });
  it("updates key and JSON configuration", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("DHT22");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText("Clave"));
    await user.type(screen.getByLabelText("Clave"), "dht22_outdoor");
    fireEvent.change(screen.getByLabelText("Configuración JSON"), { target: { value: '{"offset":1}' } });
    await user.click(screen.getByRole("button", { name: "Guardar sensor" }));
    await waitFor(() => expect(mocks.updateDeviceSensor).toHaveBeenCalledWith("device-1", "installed-1", { key: "dht22_outdoor", config: { offset: 1 } }));
  });
  it("hides mutations without ownership", async () => {
    renderSection(false);
    await screen.findByText("DHT22");
    expect(screen.queryByRole("button", { name: "Agregar sensor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
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
    await screen.findByText("DHT22");
    expect(screen.queryByRole("button", { name: "Agregar sensor" })).not.toBeInTheDocument();
  });
});
