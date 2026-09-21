import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import type { SensorReading } from "@/app/types/sensorReading.types";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface EnvironmentalReadingsChartProps {
  readings: SensorReading[];
}

const chartConfig = {
  temperatureC: {
    label: "Temperatura (°C)",
    color: "hsl(var(--chart-1))",
  },
  relativeHumidityPct: {
    label: "Humedad relativa (%)",
    color: "hsl(var(--chart-3))",
  },
  pressureHpa: {
    label: "Presión (hPa)",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

const formatTime = (value: string) => format(new Date(value), "HH:mm");
const formatTimestamp = (value: string) =>
  format(new Date(value), "PP p", { locale: es });

export function EnvironmentalReadingsChart({
  readings,
}: EnvironmentalReadingsChartProps) {
  return (
    <ChartContainer
      config={chartConfig}
      className="h-[320px] w-full"
      role="img"
      aria-label="Historial de lecturas ambientales"
    >
      <LineChart
        accessibilityLayer
        data={readings}
        margin={{ top: 8, right: 12, bottom: 8, left: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          yAxisId="environmental"
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <YAxis
          yAxisId="pressure"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(value) => formatTimestamp(String(value))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          yAxisId="environmental"
          dataKey="temperatureC"
          type="monotone"
          stroke="var(--color-temperatureC)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          yAxisId="environmental"
          dataKey="relativeHumidityPct"
          type="monotone"
          stroke="var(--color-relativeHumidityPct)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          yAxisId="pressure"
          dataKey="pressureHpa"
          type="monotone"
          stroke="var(--color-pressureHpa)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
