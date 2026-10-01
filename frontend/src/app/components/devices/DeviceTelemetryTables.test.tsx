import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDaily, getHistory, downloadReport } = vi.hoisted(() => ({ getDaily: vi.fn(), getHistory: vi.fn(), downloadReport: vi.fn() }));
vi.mock("@/app/services/environmentalSensor.service", () => ({ environmentalSensorService: { getDaily, getHistory } }));
vi.mock("@/lib/downloadReport", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/downloadReport")>()), downloadReport }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { fullName: "Ana" } }) }));

import { DeviceDailySummary, DeviceDetailedReadings } from "./DeviceTelemetryTables";

const device = { id: "d1", name: "Sala", serial: "IOT-DEM0-0003" };
const start = new Date(2026, 8, 1).toISOString();
const end = new Date(2026, 8, 3, 23, 59).toISOString();
const dht = { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] };
const dailyPayload = { sensors: [dht], days: [{ date: "2026-09-02", sensors: { dht22: { temperature: { min: 10, max: 20, avg: 15, count: 4 } } } }] };

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("DeviceDailySummary", () => {
  it("requests the daily summary with the local UTC offset and renders date, min/max/avg and readings", async () => {
    getDaily.mockResolvedValue(dailyPayload);
    renderWith(<DeviceDailySummary device={device} start={start} end={end} />);
    expect(await screen.findAllByText("02/09/2026")).not.toHaveLength(0);
    expect(getDaily).toHaveBeenCalledWith("d1", start, end, -new Date(end).getTimezoneOffset());
    const table = screen.getByRole("table");
    expect(within(table).getByText("DHT22 · Temperatura (°C)")).toBeInTheDocument();
    for (const label of ["Mín", "Máx", "Prom", "Lecturas"]) expect(within(table).getByText(label)).toBeInTheDocument();
    expect(within(table).getByText("10 °C")).toBeInTheDocument();
    expect(within(table).getByText("15 °C")).toBeInTheDocument();
    expect(within(table).getAllByText("4").length).toBeGreaterThan(0);
  });

  it("shows an empty state and disables exports when there are no days", async () => {
    getDaily.mockResolvedValue({ days: [], sensors: [] });
    renderWith(<DeviceDailySummary device={device} start={start} end={end} />);
    expect(await screen.findByText("No hay lecturas en el período seleccionado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excel/ })).toBeDisabled();
  });

  it("shows an error state", async () => {
    getDaily.mockRejectedValue(new Error("boom"));
    renderWith(<DeviceDailySummary device={device} start={start} end={end} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el resumen diario.");
  });

  it("exports Excel and PDF with title, subtitle, filename and typed cells", async () => {
    getDaily.mockResolvedValue(dailyPayload);
    renderWith(<DeviceDailySummary device={device} start={start} end={end} />);
    await screen.findAllByText("02/09/2026");
    await userEvent.click(screen.getByRole("button", { name: /Excel/ }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(1));
    const [format, options] = downloadReport.mock.calls[0];
    expect(format).toBe("excel");
    expect(options).toMatchObject({
      title: "Resumen diario de telemetría", generatedBy: "Ana",
      filename: "resumen-diario-telemetria_IOT-DEM0-0003_2026-09-01_2026-09-03",
      subtitle: "Dispositivo: Sala (IOT-DEM0-0003) · Período: 01/09/2026 00:00 - 03/09/2026 23:59",
    });
    expect(options.columns[0]).toBe("Fecha");
    expect(options.data[0][0]).toMatchObject({ kind: "date", value: "2026-09-02" });
    await userEvent.click(screen.getByRole("button", { name: /PDF/ }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(2));
    expect(downloadReport.mock.calls[1][0]).toBe("pdf");
  });
});

describe("DeviceDetailedReadings", () => {
  const item = (time: string, t: number) => ({ time, values: { dht22: { temperature: t } } });

  it("pages the history server-side and renders one column per sensor variable", async () => {
    getHistory.mockResolvedValue({ items: [item("2026-09-02T12:00:00Z", 21.5)], total: 25, page: 1, perPage: 10, pages: 3, sensors: [dht] });
    renderWith(<DeviceDetailedReadings device={device} start={start} end={end} />);
    expect(await screen.findAllByText("21,5 °C")).not.toHaveLength(0);
    expect(getHistory).toHaveBeenCalledWith("d1", start, end, 1, 10);
    expect(screen.getByRole("columnheader", { name: /Fecha y hora/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /DHT22 · Temperatura \(°C\)/ })).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    getHistory.mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10, pages: 0, sensors: [] });
    renderWith(<DeviceDetailedReadings device={device} start={start} end={end} />);
    expect(await screen.findByText("No hay lecturas en el período seleccionado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeDisabled();
  });

  it("exports every page in range with the detailed title, subtitle and datetime cells", async () => {
    getHistory.mockImplementation(async (_id: string, _s: string, _e: string, page: number, perPage: number) => ({
      items: page === 1 ? [item("2026-09-02T12:00:00Z", 21.5)] : [item("2026-09-02T13:00:00Z", 22.5)],
      total: perPage === 10 ? 25 : 10001, page, perPage, pages: 1, sensors: [dht],
    }));
    renderWith(<DeviceDetailedReadings device={device} start={start} end={end} />);
    await screen.findAllByText("21,5 °C");
    await userEvent.click(screen.getByRole("button", { name: /Excel/ }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(1));
    const [format, options] = downloadReport.mock.calls[0];
    expect(format).toBe("excel");
    expect(options).toMatchObject({
      title: "Telemetría detallada",
      filename: "telemetria-detallada_IOT-DEM0-0003_2026-09-01_2026-09-03",
      subtitle: expect.stringContaining("Período: 01/09/2026 00:00 - 03/09/2026 23:59"),
    });
    expect(options.columns).toEqual(["Fecha y hora", "DHT22 · Temperatura (°C)"]);
    expect(options.data).toHaveLength(2);
    expect(options.data[0][0]).toMatchObject({ kind: "datetime" });
    expect(getHistory).toHaveBeenCalledWith("d1", start, end, 1, 10000);
    expect(getHistory).toHaveBeenCalledWith("d1", start, end, 2, 10000);
  });
});
