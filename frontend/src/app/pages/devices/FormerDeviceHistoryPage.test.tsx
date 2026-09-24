import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/deviceHistory.api", () => ({ deviceHistoryApi: {
  telemetry: vi.fn().mockResolvedValue({ items: [], sensors: [], total: 0, page: 1, perPage: 10, pages: 0 }),
  variables: vi.fn().mockResolvedValue([]),
  operations: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0 }),
} }));
vi.mock("@/lib/downloadReport", () => ({ downloadReport: vi.fn().mockResolvedValue(undefined) }));

import FormerDeviceHistoryPage from "./FormerDeviceHistoryPage";
import { deviceHistoryApi } from "@/api/deviceHistory.api";
import { downloadReport } from "@/lib/downloadReport";
import { useAuthStore } from "@/auth/store/auth.store";

describe("device history page", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { isAdmin: false, permissions: ["telemetry:read"] } as never });
    vi.mocked(deviceHistoryApi.telemetry).mockClear();
    vi.mocked(deviceHistoryApi.variables).mockClear();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("does not query or offer telemetry actions without telemetry:read", async () => {
    useAuthStore.setState({ user: { isAdmin: false, permissions: [] } as never });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    expect(within(tab).getByRole("alert")).toHaveTextContent("No tienes acceso a la telemetría");
    expect(within(tab).queryByRole("button", { name: "Excel" })).not.toBeInTheDocument();
    expect(deviceHistoryApi.telemetry).not.toHaveBeenCalled();
    expect(deviceHistoryApi.variables).not.toHaveBeenCalled();
  });

  it("offers catalog variables absent from the current telemetry page", async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ user: { isAdmin: false, permissions: ["telemetry:read", "sensor_catalog:read"] } as never });
    vi.mocked(deviceHistoryApi.variables).mockResolvedValue([{ id: "v-pressure", code: "pressure", name: "Presión", unit: "hPa" }]);
    vi.mocked(deviceHistoryApi.telemetry).mockResolvedValue({ items: [{ time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 23.4 } } }], sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    await user.click(within(tab).getByRole("button", { name: "Filtros" }));
    await user.click(within(tab).getByRole("combobox", { name: "Variable" }));
    expect(await screen.findByRole("option", { name: "Presión (hPa)" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Presión (hPa)" }));
    await waitFor(() => expect(deviceHistoryApi.telemetry).toHaveBeenCalledWith("SN-1", expect.objectContaining({ variable: "pressure" })));
  });

  it("uses visible telemetry metadata when catalog permission is unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(deviceHistoryApi.telemetry).mockResolvedValue({ items: [{ time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 23.4 } } }], sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    await user.click(within(tab).getByRole("button", { name: "Filtros" }));
    expect(within(tab).getByText("Solo se muestran las variables de los registros cargados.")).toBeInTheDocument();
    expect(deviceHistoryApi.variables).not.toHaveBeenCalled();
    await user.click(within(tab).getByRole("combobox", { name: "Variable" }));
    expect(await screen.findByRole("option", { name: "Temperatura (°C)" })).toBeInTheDocument();
  });
  it("opens telemetry first and keeps operations mounted under the same environment", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: /Historial: SN-1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Telemetría" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Operaciones" })).toBeInTheDocument();
  });

  it("preserves each tab's search when switching and places dates beside filters", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const telemetry = screen.getByRole("tab", { name: "Telemetría" });
    const operations = screen.getByRole("tab", { name: "Operaciones" });
    const search = within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByPlaceholderText("Buscar en todos los campos...");
    await user.type(search, "sensor");
    expect(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByLabelText("Fecha desde")).toBeInTheDocument();
    await user.click(operations);
    await user.click(telemetry);
    expect(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByPlaceholderText("Buscar en todos los campos...")).toHaveValue("sensor");
  });

  it("queries server-filtered pages instead of fetching all rows or filtering them locally", async () => {
    const user = userEvent.setup();
    const readings = vi.mocked(deviceHistoryApi.telemetry);
    readings.mockResolvedValue({ items: [{ time: "2026-08-31T12:00:00Z", values: { dht22: { temperature: 22 } } }], sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await user.type(within(screen.getByRole("tabpanel", { name: "Telemetría" })).getByLabelText("Fecha desde"), "2026-09-01");
    await waitFor(() => expect(readings).toHaveBeenCalledWith("SN-1", expect.objectContaining({ dateFrom: "2026-09-01", page: 1, perPage: 10 })));
    expect(readings.mock.calls.every(([, params]) => params.perPage === 10)).toBe(true);
    expect(await screen.findByText("22 °C")).toBeInTheDocument();
  });

  it("exports every server-filtered row with the selected date range", async () => {
    const user = userEvent.setup();
    const readings = vi.mocked(deviceHistoryApi.telemetry);
    readings.mockResolvedValue({ items: [{ time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 22 } } }], sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] }], total: 1, page: 1, perPage: 10, pages: 1 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    await user.type(within(tab).getByLabelText("Fecha desde"), "2026-09-01");
    await waitFor(() => expect(within(tab).getByRole("button", { name: "Excel" })).toBeEnabled());
    await user.click(within(tab).getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(readings).toHaveBeenCalledWith("SN-1", expect.objectContaining({ dateFrom: "2026-09-01", page: 1, perPage: 10000 })));
  });

  it("unions dynamic columns from every export page", async () => {
    const user = userEvent.setup();
    const telemetry = vi.mocked(deviceHistoryApi.telemetry);
    const dht = { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] };
    const bmp = { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "pressure", name: "Presión", unit: "hPa" }] };
    telemetry.mockImplementation(async (_, params) => params.page === 1
      ? { items: [{ time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 23.4 } } }], sensors: [dht], total: 10001, page: 1, perPage: 10000, pages: 2 }
      : { items: [{ time: "2026-09-02T12:00:00Z", values: { bmp280: { pressure: 1012.6 } } }], sensors: [bmp], total: 10001, page: 2, perPage: 10000, pages: 2 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/app/devices/history/SN-1?environmentId=env-1"]}><Routes><Route path="/app/devices/history/:serial" element={<FormerDeviceHistoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const tab = screen.getByRole("tabpanel", { name: "Telemetría" });
    await waitFor(() => expect(within(tab).getByRole("button", { name: "PDF" })).toBeEnabled());
    await user.click(within(tab).getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledWith("pdf", expect.objectContaining({ columns: ["Fecha/Hora", "DHT22 · Temperatura (°C)", "BMP280 · Presión (hPa)"], data: expect.arrayContaining([expect.arrayContaining(["23,4 °C", "-"]), expect.arrayContaining(["-", "1.012,6 hPa"])]) })));
  });
});
