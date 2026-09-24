import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeviceDetailPage from "./DeviceDetailPage";

const mocks = vi.hoisted(() => ({ getHistory: vi.fn(), getLatest: vi.fn(), guestCard: vi.fn(), useQuery: vi.fn() }));
const state = vi.hoisted(() => ({ latest: undefined as unknown, history: undefined as unknown }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: { getLatest: mocks.getLatest, getHistory: mocks.getHistory } }));
vi.mock("@/app/components/devices/DeviceSensorsSection", () => ({ DeviceSensorsSection: () => <div>Sensores del dispositivo</div> }));
vi.mock("@/components/dashboard/charts/EnvironmentalReadingsChart", () => ({ EnvironmentalReadingsChart: ({ variableCode, sensors }: {variableCode: string; sensors: unknown[]}) => <div data-testid={`chart-${variableCode}`}>{sensors.length} series</div> }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: () => ({ user: { id: "owner-1", permissions: ["telemetry:read"] } }) }));
vi.mock("@/app/components/access/DeviceGuestManagementCard", () => ({ DeviceGuestManagementCard: (props: unknown) => { mocks.guestCard(props); return <div>Access management</div>; } }));
const device = { id: "device-1", name: "Sensor norte", serial: "IOT-0000-0001", brokerConnected: true, environment: { name: "Establecimiento", ownerId: "owner-1" } };
const sensors = [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }, { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }];
const telemetry = { items: [{ time: "2026-09-21T12:30:00Z", values: { dht22: { temperature: 23.4 }, bmp280: { temperature: 22.9 } } }], total: 1, sensors };
const result = (data?: unknown, opts: { isLoading?: boolean; isError?: boolean } = {}) => ({ data, isLoading: opts.isLoading ?? false, isError: opts.isError ?? false });
function renderPage() { return render(<MemoryRouter initialEntries={["/app/devices/device-1"]}><Routes><Route path="/app/devices/:id" element={<DeviceDetailPage />} /></Routes></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); state.latest = result({ items: [], total: 0, sensors: [] }); state.history = result({ items: [], total: 0, sensors: [] }); mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => options.queryKey[0] === "device" ? result(device) : options.queryKey[1] === "latest" ? state.latest : state.history); });

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
});
