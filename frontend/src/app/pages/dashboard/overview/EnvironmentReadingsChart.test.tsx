import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentReadingsChart } from "./EnvironmentReadingsChart";
import type { EnvironmentSeries } from "./environmentSeries";

const mocks = vi.hoisted(() => ({ config: vi.fn(), line: vi.fn(), tooltip: vi.fn() }));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children, config, ...props }: { children: ReactNode; config: unknown }) => {
    mocks.config(config);
    return <div {...props}>{children}</div>;
  },
  ChartLegend: () => <div data-testid="legend" />,
  ChartLegendContent: () => null,
  ChartTooltip: ({ content }: { content: { props: unknown } }) => {
    mocks.tooltip(content.props);
    return null;
  },
  ChartTooltipContent: () => null,
}));
vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: (props: unknown) => {
    mocks.line(props);
    return null;
  },
  XAxis: () => null,
  YAxis: () => null,
}));

const variable = { code: "temperature", name: "Temperatura", unit: "°C" };
const series: EnvironmentSeries[] = Array.from({ length: 6 }, (_, index) => ({
  key: `s${index}`,
  label: `Sensor ${index} · DHT22`,
  deviceId: `device-${index}`,
  sensorKey: "dht22",
}));

beforeEach(() => vi.clearAllMocks());

describe("EnvironmentReadingsChart", () => {
  it("draws one connected line per series with a legend and accessible name", () => {
    render(<EnvironmentReadingsChart variable={variable} series={series} points={[]} range="24h" />);

    expect(screen.getByRole("img", { name: "Historial de Temperatura por sensor del establecimiento" })).toBeInTheDocument();
    expect(screen.getByTestId("legend")).toBeInTheDocument();
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({
      s0: { label: "Sensor 0 · DHT22", color: "var(--chart-1)" },
      s5: { label: "Sensor 5 · DHT22", color: "var(--chart-1)" },
    }));
    const lines = mocks.line.mock.calls.map(([props]) => props as { dataKey: string; connectNulls: boolean; strokeDasharray?: string });
    expect(lines.map((line) => line.dataKey)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(lines.every((line) => line.connectNulls)).toBe(true);
    expect(lines[0].strokeDasharray).toBeUndefined();
    expect(lines[5].strokeDasharray).toBeTruthy();
  });

  it("accepts a custom accessible name", () => {
    render(
      <EnvironmentReadingsChart
        variable={variable}
        series={series.slice(0, 1)}
        points={[]}
        range="24h"
        ariaLabel="Historial de Temperatura por sensor del dispositivo"
      />,
    );

    expect(screen.getByRole("img", { name: "Historial de Temperatura por sensor del dispositivo" })).toBeInTheDocument();
  });

  it("formats tooltip values with the es-AR locale and the variable unit", () => {
    render(<EnvironmentReadingsChart variable={variable} series={series} points={[]} range="1h" />);

    const { formatter } = mocks.tooltip.mock.calls[0][0] as {
      formatter: (value: unknown, name: string, item: { color: string }) => ReactNode;
    };
    render(<>{formatter(23.456, "s1", { color: "red" })}</>);

    expect(screen.getByText("Sensor 1 · DHT22")).toBeInTheDocument();
    expect(screen.getByText("23,46 °C")).toBeInTheDocument();
    expect(formatter(null, "s1", { color: "red" })).toBeNull();
  });

  it("keeps the tooltip time visible when a single series has a value", () => {
    render(<EnvironmentReadingsChart variable={variable} series={series} points={[]} range="1h" />);

    // shadcn nests (and with a custom formatter drops) the label for one-item payloads unless the indicator is "dot".
    const { indicator, labelFormatter } = mocks.tooltip.mock.calls[0][0] as {
      indicator: string;
      labelFormatter: (label: unknown, payload: { payload: { time: number } }[]) => ReactNode;
    };
    expect(indicator).toBe("dot");
    expect(labelFormatter(undefined, [{ payload: { time: Date.parse("2026-10-10T12:30:00Z") } }])).toBeTruthy();
  });
});
