import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { TelemetryItem, TelemetrySensor } from "@/app/types/environmentalSensor.types";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface EnvironmentalReadingsChartProps {
  readings: TelemetryItem[];
  variableCode: string;
  sensors: TelemetrySensor[];
}

const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function EnvironmentalReadingsChart({ readings, variableCode, sensors }: EnvironmentalReadingsChartProps) {
  const series = sensors.filter((sensor) => sensor.variables.some((variable) => variable.code === variableCode));
  const variable = series[0]?.variables.find((entry) => entry.code === variableCode);
  const config: ChartConfig = Object.fromEntries(series.map((sensor, index) => [`series_${index}`, {
    label: `${sensor.sensorName} · ${sensor.key}`,
    color: colors[index % colors.length],
  }]));
  const chartData = [...readings].reverse().map((reading) => ({
    time: reading.time,
    ...Object.fromEntries(series.map((sensor, index) => [`series_${index}`, reading.values[sensor.key]?.[variableCode] ?? null])),
  }));

  return <ChartContainer config={config} className="h-[280px] w-full" role="img" aria-label={`Historial de ${variable?.name ?? variableCode}`}>
    <LineChart accessibilityLayer data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="time" tickFormatter={(value: string) => format(new Date(value), "HH:mm")} tickLine={false} axisLine={false} minTickGap={24} />
      <YAxis tickLine={false} axisLine={false} width={48} />
      <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => format(new Date(String(value)), "PP p", { locale: es })} />} />
      <ChartLegend content={<ChartLegendContent />} />
      {series.map((sensor, index) => <Line key={sensor.key} dataKey={`series_${index}`} type="monotone" stroke={`var(--color-series_${index})`} strokeWidth={2} dot={false} connectNulls={false} />)}
    </LineChart>
  </ChartContainer>;
}
