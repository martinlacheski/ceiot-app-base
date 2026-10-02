import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceTypeFormPage } from "./DeviceTypeFormPage";

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn(), getCatalog: vi.fn() }));
vi.mock("./deviceTypesApi", () => ({ deviceTypesApi: { get: mocks.get, create: mocks.create, update: mocks.update } }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: { getCatalog: mocks.getCatalog } }));

const catalog = [
  { id: "dht22", code: "dht22", name: "DHT22", manufacturer: "Aosong", variables: [{ code: "temperature", name: "Temperatura", unit: "°C", min: 0, max: 50, accuracy: "", resolution: "" }, { code: "relative_humidity", name: "Humedad relativa", unit: "%", min: 0, max: 100, accuracy: "", resolution: "" }] },
  { id: "bme280", code: "bme280", name: "BME280", manufacturer: "Bosch", variables: [{ code: "pressure", name: "Presión", unit: "hPa", min: 300, max: 1100, accuracy: "", resolution: "" }] },
];

function renderForm(path = "/admin/device-types/create") {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/device-types/create" element={<DeviceTypeFormPage />} />
    <Route path="/admin/device-types/edit/:id" element={<DeviceTypeFormPage />} />
    <Route path="/admin/device-types" element={<p>Listado</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); mocks.getCatalog.mockResolvedValue(catalog); mocks.create.mockResolvedValue({}); mocks.update.mockResolvedValue({}); });

describe("device type form", () => {
  it("uses the standard title, one main row of three fields and form actions", async () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Nuevo tipo de dispositivo" })).toBeInTheDocument();
    const main = screen.getByTestId("device-type-main-fields");
    expect(main).toHaveClass("md:grid-cols-3");
    for (const label of ["Código", "Nombre", "Modelo de placa"]) expect(within(main).getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción")).toBeInTheDocument();
    for (const label of ["Intervalo de telemetría (s)", "Considerar sin conexión después de (s)", "Mínimo de sensores"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Plantilla de configuración (JSON)")).toBeInTheDocument();
    expect(screen.getByTestId("form-actions")).toHaveClass("grid-cols-2", "sm:flex");
    expect(within(screen.getByTestId("form-actions")).getByRole("button", { name: "Volver" })).toHaveClass("h-11");
  });

  it("edits the compatible sensors table: columns, primary add button, variables and per-row options", async () => {
    renderForm();
    expect(screen.getByText("No hay sensores compatibles.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Sensor", "Variables", "Obligatorio", "Máx.", "Incluido por defecto", "Acciones"]);
    const add = screen.getByRole("button", { name: "Agregar sensor" });
    expect(add).toHaveClass("bg-primary", "h-11");
    expect(add.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(add);
    const select = await screen.findByLabelText("Sensor 1");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
    fireEvent.change(select, { target: { value: "dht22" } });
    expect(screen.getByText("Temperatura (°C), Humedad relativa (%)")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Máx. 1" })).toHaveValue(1);
    expect(screen.getByRole("checkbox", { name: "Obligatorio 1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Incluido por defecto 1" })).not.toBeChecked();
    // A model already used in another row is not offered again.
    fireEvent.click(screen.getByRole("button", { name: "Agregar sensor" }));
    const second = screen.getByLabelText("Sensor 2");
    expect(within(second).queryByRole("option", { name: "DHT22" })).toBeNull();
    expect(within(second).getByRole("option", { name: "BME280" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar sensor" })[1]);
    expect(screen.queryByLabelText("Sensor 2")).toBeNull();
  });

  it("blocks saving an invalid configuration template or minimum and shows the message", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "weather_station" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Estación" } });
    fireEvent.change(screen.getByLabelText("Plantilla de configuración (JSON)"), { target: { value: "[1]" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tipo de dispositivo" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La plantilla de configuración debe ser un objeto JSON válido.");
    fireEvent.change(screen.getByLabelText("Plantilla de configuración (JSON)"), { target: { value: "{}" } });
    fireEvent.change(screen.getByLabelText("Mínimo de sensores"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tipo de dispositivo" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Para exigir sensores agrega al menos un sensor compatible.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a type with its compatible sensors", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "weather_station" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Estación" } });
    fireEvent.change(screen.getByLabelText("Modelo de placa"), { target: { value: "ESP32-S3" } });
    fireEvent.change(screen.getByLabelText("Intervalo de telemetría (s)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Mínimo de sensores"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar sensor" }));
    const select = await screen.findByLabelText("Sensor 1");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
    fireEvent.change(select, { target: { value: "bme280" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluido por defecto 1" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Máx. 1" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tipo de dispositivo" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith({
      code: "weather_station", name: "Estación", description: null, hardwareModel: "ESP32-S3", telemetryIntervalS: 60, offlineAfterS: null, minSensors: 1, configTemplate: {},
      sensors: [{ sensorId: "bme280", required: false, maxCount: 2, includedByDefault: true }],
    });
    expect(await screen.findByText("Listado")).toBeInTheDocument();
  });

  it("loads an existing type: immutable code, active switch, and sends no code on update", async () => {
    mocks.get.mockResolvedValue({ id: "t1", code: "environmental", name: "Ambiental", description: "Clima", hardwareModel: "ESP32-DevKit", telemetryIntervalS: 30, offlineAfterS: 90, minSensors: 1, configTemplate: { i2c: { sda: 21 } }, isActive: true,
      sensors: [{ sensorId: "bme280", code: "bme280", name: "BME280", manufacturer: "Bosch", isActive: true, required: true, maxCount: 2, includedByDefault: true, variables: [] }] });
    renderForm("/admin/device-types/edit/t1");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Ambiental"));
    expect(screen.getByRole("heading", { name: "Editar tipo de dispositivo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código")).toBeDisabled();
    expect(screen.getByLabelText("Código")).toHaveValue("environmental");
    expect(screen.getByLabelText("Plantilla de configuración (JSON)")).toHaveValue(JSON.stringify({ i2c: { sda: 21 } }, null, 2));
    expect(screen.getByRole("checkbox", { name: "Obligatorio 1" })).toBeChecked();
    expect(screen.getByLabelText("Activo")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Ambiental 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [id, body] = mocks.update.mock.calls[0];
    expect(id).toBe("t1");
    expect(body).not.toHaveProperty("code");
    expect(body).toMatchObject({ name: "Ambiental 2", isActive: true, minSensors: 1, sensors: [{ sensorId: "bme280", required: true, maxCount: 2, includedByDefault: true }] });
  });

  it("shows the server message when saving fails", async () => {
    mocks.create.mockRejectedValue({ response: { status: 409, data: { detail: "Ya existe un tipo de dispositivo con ese código" } } });
    renderForm();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "weather_station" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Estación" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear tipo de dispositivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un tipo de dispositivo con ese código");
  });
});
