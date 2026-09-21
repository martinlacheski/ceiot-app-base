import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentalReadingsChart } from "./EnvironmentalReadingsChart";

const chartMocks = vi.hoisted(() => ({
  chartContainer: vi.fn(),
  lineChart: vi.fn(),
  line: vi.fn(),
  xAxis: vi.fn(),
  tooltipContent: vi.fn(),
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({
    children,
    config,
    ...props
  }: {
    children: ReactNode;
    config: Record<string, unknown>;
  }) => {
    chartMocks.chartContainer({ config, ...props });
    return <div {...props}>{children}</div>;
  },
  ChartLegend: ({ content }: { content: ReactNode }) => (
    <div data-testid="chart-legend">{content}</div>
  ),
  ChartLegendContent: () => <div data-testid="chart-legend-content" />,
  ChartTooltip: ({ content }: { content: ReactNode }) => (
    <div data-testid="chart-tooltip">{content}</div>
  ),
  ChartTooltipContent: (props: Record<string, unknown>) => {
    chartMocks.tooltipContent(props);
    return <div data-testid="chart-tooltip-content" />;
  },
}));

vi.mock("recharts", () => ({
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  LineChart: ({ children, ...props }: { children: ReactNode }) => {
    chartMocks.lineChart(props);
    return <div data-testid="line-chart">{children}</div>;
  },
  Line: (props: Record<string, unknown>) => {
    chartMocks.line(props);
    return <div data-testid={`line-${String(props.dataKey)}`} />;
  },
  XAxis: (props: Record<string, unknown>) => {
    chartMocks.xAxis(props);
    return <div data-testid="x-axis" />;
  },
  YAxis: (props: Record<string, unknown>) => (
    <div data-testid={`y-axis-${String(props.yAxisId)}`} />
  ),
}));

const readings = [
  {
    id: "reading-1",
    time: "2026-09-21T11:30:00Z",
    deviceId: "device-1",
    deviceSerial: "IOT-0000-0001",
    deviceType: "environmental",
    temperatureC: null,
    relativeHumidityPct: 60,
    pressureHpa: 1012.8,
  },
  {
    id: "reading-2",
    time: "2026-09-21T12:30:00Z",
    deviceId: "device-1",
    deviceSerial: "IOT-0000-0001",
    deviceType: "environmental",
    temperatureC: 24.5,
    relativeHumidityPct: 61,
    pressureHpa: 1013.2,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EnvironmentalReadingsChart", () => {
  it("renders an accessible responsive chart with all environmental series", () => {
    render(<EnvironmentalReadingsChart readings={readings} />);

    expect(
      screen.getByRole("img", { name: "Historial de lecturas ambientales" }),
    ).toHaveClass("w-full");
    expect(screen.getByTestId("line-temperatureC")).toBeInTheDocument();
    expect(
      screen.getByTestId("line-relativeHumidityPct"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("line-pressureHpa")).toBeInTheDocument();
    expect(screen.getByTestId("chart-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("chart-legend")).toBeInTheDocument();

    const containerProps = chartMocks.chartContainer.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(containerProps?.config).toMatchObject({
      temperatureC: { label: "Temperatura (°C)" },
      relativeHumidityPct: { label: "Humedad relativa (%)" },
      pressureHpa: { label: "Presión (hPa)" },
    });
  });

  it("preserves null readings and formats timestamps without inventing values", () => {
    render(<EnvironmentalReadingsChart readings={readings} />);

    const lineChartProps = chartMocks.lineChart.mock.calls.at(-1)?.[0] as
      | { data?: typeof readings }
      | undefined;
    expect(lineChartProps?.data).toEqual(readings);
    expect(lineChartProps?.data?.[0].temperatureC).toBeNull();

    const lineProps = chartMocks.line.mock.calls.map(([props]) => props);
    expect(lineProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataKey: "temperatureC",
          connectNulls: false,
        }),
        expect.objectContaining({
          dataKey: "relativeHumidityPct",
          connectNulls: false,
        }),
        expect.objectContaining({
          dataKey: "pressureHpa",
          connectNulls: false,
        }),
      ]),
    );

    const xAxisProps = chartMocks.xAxis.mock.calls.at(-1)?.[0] as
      | { dataKey?: string; tickFormatter?: (value: string) => string }
      | undefined;
    expect(xAxisProps?.dataKey).toBe("time");
    expect(xAxisProps?.tickFormatter?.(readings[0].time)).toEqual(
      expect.any(String),
    );
    expect(xAxisProps?.tickFormatter?.(readings[0].time)).not.toBe(
      readings[0].time,
    );

    const tooltipProps = chartMocks.tooltipContent.mock.calls.at(-1)?.[0] as
      | { labelFormatter?: (value: string) => string }
      | undefined;
    expect(tooltipProps?.labelFormatter?.(readings[0].time)).toContain("2026");
  });
});
