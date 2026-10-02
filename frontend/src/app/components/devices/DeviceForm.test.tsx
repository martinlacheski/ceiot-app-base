import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceForm } from "./DeviceForm";

const DEVICE_TYPE_ID = "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32";
const RELAY_TYPE_ID = "relay-type";

const link = (id: string, name: string, patch = {}) => ({
  sensorId: id, code: name.toLowerCase(), name, manufacturer: "X", isActive: true, required: false, maxCount: 2, includedByDefault: false,
  variables: [{ code: "temperature", name: "Temperatura", unit: "°C", min: -40, max: 80, accuracy: "", resolution: "" }], ...patch,
});
const ambiental = (patch = {}) => ({
  id: DEVICE_TYPE_ID, name: "Ambiental", code: "environmental", isActive: true, minSensors: 1, hardwareModel: "ESP32-DevKit", configTemplate: {},
  sensors: [link("dht22", "DHT22"), link("bme280", "BME280", { maxCount: 1, includedByDefault: true })], ...patch,
});
const relay = { id: RELAY_TYPE_ID, name: "Placa de relés", code: "relay_board", isActive: true, minSensors: 0, hardwareModel: null, configTemplate: {}, sensors: [] };

const state = vi.hoisted(() => ({ types: [] as unknown[] }));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/app/hooks/useDevices", () => ({
  useDeviceTypes: () => ({ data: { items: state.types, total: state.types.length, page: 1, perPage: 100, pages: 1 } }),
  useUnpairDevice: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: { id: string; isAdmin: boolean; permissions: string[] } }) => unknown) =>
    selector({ user: { id: "owner-1", isAdmin: false, permissions: ["device_sensor:write"] } }),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (_message: string, onConfirm: () => void) => onConfirm(),
}));

const sensorSelects = () => screen.queryAllByLabelText(/^Modelo del sensor \d+$/) as HTMLSelectElement[];
const optionNames = (select: HTMLElement) => within(select).getAllByRole("option").map((option) => option.textContent);

beforeEach(() => { state.types = [ambiental(), relay]; });

describe("DeviceForm", () => {
  it("pre-fills the sensors table with the type's default kit and shows the table standard", async () => {
    render(<MemoryRouter><DeviceForm onSubmit={vi.fn()} /></MemoryRouter>);
    const section = await screen.findByRole("region", { name: "Sensores" });
    const table = screen.getByRole("table");
    expect(section).toContainElement(table);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Sensor", "Variables", "Acciones"]);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    expect(sensorSelects()[0].value).toBe("bme280");
    expect(section).toHaveTextContent("Temperatura: -40–80 °C");
    expect(section.querySelector("button")!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(section).not.toHaveClass("border", "rounded-md", "bg-muted/50");
    expect(screen.getByRole("button", { name: "Quitar sensor" })).toHaveAttribute("title", "Quitar sensor");
    expect(screen.queryByLabelText(/clave/i)).not.toBeInTheDocument();
  });

  it("only offers models compatible with the selected type and hides the table for types without sensors", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DeviceForm onSubmit={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    expect(optionNames(sensorSelects()[1])).toEqual(["Seleccionar modelo", "DHT22"]);
    await user.click(screen.getByText("Ambiental"));
    await user.click(await screen.findByText("Placa de relés"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Sensores" })).not.toBeInTheDocument());
    await user.click(screen.getByText("Placa de relés"));
    await user.click(await screen.findByText("Ambiental"));
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    expect(sensorSelects()[0].value).toBe("bme280");
  });

  it("enforces the per-model maximum on the client and submits repeated models up to it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await user.selectOptions(sensorSelects()[1], "dht22");
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    // BME280 allows one unit and it is already used; DHT22 allows two and has one left.
    expect(optionNames(sensorSelects()[2])).toEqual(["Seleccionar modelo", "DHT22"]);
    await user.selectOptions(sensorSelects()[2], "dht22");
    // Everything is at its maximum: nothing else can be added.
    expect(screen.getByRole("button", { name: "Agregar sensor" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].sensors).toEqual([{ sensorId: "bme280" }, { sensorId: "dht22" }, { sensorId: "dht22" }]);
  });

  it("enforces the type's minimum number of sensors", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Quitar sensor" }));
    expect(screen.getByText("Todavía no agregaste sensores.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    expect(await screen.findByText("Agregá al menos un sensor")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("pluralizes the minimum and requires the type's mandatory models", async () => {
    state.types = [ambiental({ minSensors: 2, sensors: [link("dht22", "DHT22"), link("bme280", "BME280", { required: true, includedByDefault: true })] }), relay];
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    expect(await screen.findByText("Agregá al menos 2 sensores")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await user.selectOptions(sensorSelects()[1], "dht22");
    await user.selectOptions(sensorSelects()[0], "dht22");
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    expect(await screen.findByText("Falta el sensor obligatorio BME280")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects an empty model row", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Agregar sensor" }));
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    expect(await screen.findByText("Seleccioná un modelo para cada sensor")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the type's hardware model as the Modelo placeholder and default", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MemoryRouter><DeviceForm onSubmit={onSubmit} /></MemoryRouter>);
    await waitFor(() => expect(sensorSelects()).toHaveLength(1));
    expect(screen.getByLabelText("Modelo")).toHaveAttribute("placeholder", "ESP32-DevKit");
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ deviceTypeId: DEVICE_TYPE_ID, model: "ESP32-DevKit" });
    onSubmit.mockClear();
    await user.type(screen.getByLabelText("Modelo"), "ESP32-S3");
    await user.click(screen.getByRole("button", { name: "Crear Dispositivo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].model).toBe("ESP32-S3");
  });

  it("keeps editable device fields and submits no financial keys", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <DeviceForm
          isEditing
          mode="user"
          initialData={{
            id: "device-1",
            serial: "IOT-0000-0001",
            name: "Sensor norte",
            description: "Monitoreo",
            deviceTypeId: DEVICE_TYPE_ID,
            status: "active",
            isActive: true,
            enabled: true,
            environmentId: "env-1",
            environment: { ownerId: "owner-1" },
          } as never}
          onSubmit={onSubmit}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("Sensor norte");
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByText("Habilitado")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
    expect(screen.queryByText(/comisión/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sensores" })).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Guardar Cambios" }),
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).not.toHaveProperty("amount");
    expect(payload).not.toHaveProperty("dvemCommissionRate");
    expect(payload).not.toHaveProperty("guestCommissionRate");
    expect(payload).not.toHaveProperty("dispenserData");
  });
});
