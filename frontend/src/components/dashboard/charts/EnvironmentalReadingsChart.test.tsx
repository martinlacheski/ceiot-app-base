import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentalReadingsChart } from "./EnvironmentalReadingsChart";
import type { TelemetryItem } from "@/app/types/environmentalSensor.types";

const mocks = vi.hoisted(() => ({ chartContainer: vi.fn(), lineChart: vi.fn(), line: vi.fn() }));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children, config, ...props }: { children: ReactNode; config: unknown }) => { mocks.chartContainer(config); return <div {...props}>{children}</div>; },
  ChartLegend: () => <div data-testid="legend" />,
  ChartLegendContent: () => null,
  ChartTooltip: () => <div data-testid="tooltip" />,
  ChartTooltipContent: () => null,
}));
vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => { mocks.lineChart(data); return <div>{children}</div>; },
  Line: (props: unknown) => { mocks.line(props); return null; },
  XAxis: () => null,
  YAxis: () => null,
}));
const sensors = [
  { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] },
  { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] },
];
const readings: TelemetryItem[] = [
  { time: "2026-09-21T12:30:00Z", values: { dht22: { temperature: 23.4 }, bmp280: { temperature: 22.9 } } },
  { time: "2026-09-21T11:30:00Z", values: { dht22: { temperature: 22.1 } } },
];
beforeEach(() => vi.clearAllMocks());
describe("EnvironmentalReadingsChart", () => {
  it("renders one line per sensor key for a shared variable", () => {
    render(<EnvironmentalReadingsChart readings={readings} variableCode="temperature" sensors={sensors} />);
    expect(screen.getByRole("img", { name: "Historial de Temperatura" })).toBeInTheDocument();
    expect(mocks.line).toHaveBeenCalledTimes(2);
    expect(mocks.line.mock.calls.map(([props]) => props.dataKey)).toEqual(["series_0", "series_1"]);
    expect(mocks.chartContainer.mock.calls[0][0]).toMatchObject({ series_0: { label: "DHT22 · dht22" }, series_1: { label: "BMP280 · bmp280" } });
  });
  it("keeps missing values null and chronological order", () => {
    render(<EnvironmentalReadingsChart readings={readings} variableCode="temperature" sensors={sensors} />);
    expect(mocks.lineChart.mock.calls[0][0]).toEqual([
      { time: "2026-09-21T11:30:00Z", series_0: 22.1, series_1: null },
      { time: "2026-09-21T12:30:00Z", series_0: 23.4, series_1: 22.9 },
    ]);
    expect(mocks.line.mock.calls[0][0]).toMatchObject({ connectNulls: false });
  });
});
