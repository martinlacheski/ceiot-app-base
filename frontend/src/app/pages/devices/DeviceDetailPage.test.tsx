import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeviceDetailPage from "./DeviceDetailPage";

const mocks = vi.hoisted(() => ({ getHistory: vi.fn(), getLatest: vi.fn(), guestCard: vi.fn(), tables: vi.fn(), useQuery: vi.fn() }));
const state = vi.hoisted(() => ({ latest: undefined as unknown, history: undefined as unknown, isAdmin: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: { getLatest: mocks.getLatest, getHistory: mocks.getHistory } }));
vi.mock("@/app/components/devices/DeviceSensorsSection", () => ({ DeviceSensorsSection: () => <div>Sensores del dispositivo</div> }));
vi.mock("@/components/dashboard/charts/EnvironmentalReadingsChart", () => ({ EnvironmentalReadingsChart: ({ variableCode, sensors }: {variableCode: string; sensors: unknown[]}) => <div data-testid={`chart-${variableCode}`}>{sensors.length} series</div> }));
vi.mock("@/app/components/devices/DeviceTelemetryTables", () => ({
  DeviceDailySummary: (props: unknown) => { mocks.tables("daily", props); return <div>Tabla resumen diario</div>; },
  DeviceDetailedReadings: (props: unknown) => { mocks.tables("detailed", props); return <div>Tabla vista detallada</div>; },
}));
vi.mock("@/components/ui/date-range-picker", () => ({
  DateRangePicker: ({ onUpdate }: { onUpdate: (values: { range: { from: Date; to?: Date } }) => void }) =>
    <button onClick={() => onUpdate({ range: { from: new Date(2026, 8, 1, 15), to: new Date(2026, 8, 3, 9) } })}>Elegir fechas</button>,
}));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: () => ({ user: { id: "owner-1", permissions: ["telemetry:read"], isAdmin: state.isAdmin } }) }));
vi.mock("@/app/components/devices/DeviceFirmwareSection", () => ({ DeviceFirmwareSection: ({ device }: { device: { id: string } }) => <div>Firmware de {device.id}</div> }));
vi.mock("@/app/components/access/DeviceGuestManagementCard", () => ({ DeviceGuestManagementCard: (props: unknown) => { mocks.guestCard(props); return <div>Access management</div>; } }));
const device = { id: "device-1", name: "Sensor norte", serial: "IOT-0000-0001", brokerConnected: true, environment: { name: "Establecimiento", ownerId: "owner-1" } };
const sensors = [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }, { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }];
const telemetry = { items: [{ time: "2026-09-21T12:30:00Z", values: { dht22: { temperature: 23.4 }, bmp280: { temperature: 22.9 } } }], total: 1, sensors };
const result = (data?: unknown, opts: { isLoading?: boolean; isError?: boolean } = {}) => ({ data, isLoading: opts.isLoading ?? false, isError: opts.isError ?? false });
function renderPage() { return render(<MemoryRouter initialEntries={["/app/devices/device-1"]}><Routes><Route path="/app/devices/:id" element={<DeviceDetailPage />} /></Routes></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); state.isAdmin = false; state.latest = result({ items: [], total: 0, sensors: [] }); state.history = result({ items: [], total: 0, sensors: [] }); mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => options.queryKey[0] === "device" ? result(device) : options.queryKey[1] === "latest" ? state.latest : state.history); });

describe("DeviceDetailPage", () => {
  it("uses current-device telemetry endpoints with a rolling period", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:30:00.000Z"));
    renderPage();
    const queries = mocks.useQuery.mock.calls.map(([options]) => options);
    const latest = queries.find((options) => options.queryKey[1] === "latest");
    const history = queries.find((options) => options.queryKey[1] === "history");
    expect(latest.queryKey).toEqual(["telemetry", "latest", "device-1"]);
    expect(history.queryKey).toEqual(["telemetry", "history", "device-1", "24h"]);
    expect(latest.refetchInterval).toBe(5000);
    await latest.queryFn(); await history.queryFn();
    expect(mocks.getLatest).toHaveBeenCalledWith("device-1", 1);
    expect(mocks.getHistory).toHaveBeenCalledWith("device-1", "2026-09-20T12:30:00.000Z", "2026-09-21T12:30:00.000Z");
    vi.useRealTimers();
  });
  it("shows sensor management and grouped measurements", () => {
    state.latest = result(telemetry); state.history = result(telemetry);
    renderPage();
    expect(screen.getByText("Sensores del dispositivo")).toBeInTheDocument();
    expect(screen.getByText(/23,4 °C/)).toBeInTheDocument();
    expect(screen.getByText(/22,9 °C/)).toBeInTheDocument();
    expect(screen.getByTestId("chart-temperature")).toHaveTextContent("2 series");
    expect(mocks.guestCard).toHaveBeenCalledWith({ deviceId: "device-1", isOwner: true });
  });
  it("shows honest loading, error and empty states", () => {
    const view = renderPage();
    expect(screen.getByText("Aún no hay lecturas ambientales.")).toBeInTheDocument();
    state.latest = result(undefined, { isLoading: true }); view.rerender(<MemoryRouter initialEntries={["/app/devices/device-1"]}><Routes><Route path="/app/devices/:id" element={<DeviceDetailPage />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Cargando valores actuales…")).toBeInTheDocument();
    state.latest = result(undefined, { isError: true }); state.history = result(); view.rerender(<MemoryRouter initialEntries={["/app/devices/device-1"]}><Routes><Route path="/app/devices/:id" element={<DeviceDetailPage />} /></Routes></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los valores actuales.");
  });
  it("switches between charts, daily summary and detailed view for the selected period", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:30:00.000Z"));
    state.latest = result(telemetry); state.history = result(telemetry);
    renderPage();
    const group = screen.getByRole("group", { name: "Vista de las lecturas" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gráficos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("chart-temperature")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resumen diario" }));
    expect(screen.getByText("Tabla resumen diario")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-temperature")).not.toBeInTheDocument();
    expect(mocks.tables).toHaveBeenLastCalledWith("daily", expect.objectContaining({
      device: expect.objectContaining({ id: "device-1", serial: "IOT-0000-0001", name: "Sensor norte" }),
      start: "2026-09-20T12:30:00.000Z", end: "2026-09-21T12:30:00.000Z" }));
    fireEvent.change(screen.getByLabelText("Período de lecturas"), { target: { value: "7d" } });
    expect(mocks.tables).toHaveBeenLastCalledWith("daily", expect.objectContaining({ start: "2026-09-14T12:30:00.000Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Vista detallada" }));
    expect(screen.getByText("Tabla vista detallada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gráficos" }));
    expect(screen.getByTestId("chart-temperature")).toBeInTheDocument();
    vi.useRealTimers();
  });
  it("supports a custom date range covering whole local days", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resumen diario" }));
    fireEvent.change(screen.getByLabelText("Período de lecturas"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Elegir fechas" }));
    expect(mocks.tables).toHaveBeenLastCalledWith("daily", expect.objectContaining({
      start: new Date(2026, 8, 1, 0, 0, 0, 0).toISOString(),
      end: new Date(2026, 8, 3, 23, 59, 59, 999).toISOString() }));
  });

  it("offers the firmware update only to administrators", () => {
    const { unmount } = renderPage();
    expect(screen.queryByText("Firmware de device-1")).toBeNull();
    unmount();
    state.isAdmin = true;
    renderPage();
    expect(screen.getByText("Firmware de device-1")).toBeInTheDocument();
  });
});
