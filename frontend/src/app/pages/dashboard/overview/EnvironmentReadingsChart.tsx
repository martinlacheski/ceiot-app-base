import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { seriesStroke, type EnvironmentPoint, type EnvironmentSeries } from "./environmentSeries";
import type { ReadingsRange, ReadingsWindow } from "./overviewModel";

interface EnvironmentReadingsChartProps {
  variable: TelemetryVariable;
  /** Every series of the variable; the position fixes its color, so hiding one never repaints the rest. */
  series: EnvironmentSeries[];
  /** Chart keys left out of the lines, the tooltip and the Y domain. */
  hiddenKeys?: ReadonlySet<string>;
  points: EnvironmentPoint[];
  range: ReadingsRange;
  /** Rolling window shown on the X axis; without it the axis fits the data. */
  timeWindow?: ReadingsWindow;
  /** Accessible name; defaults to the establishment wording. */
  ariaLabel?: string;
}

const numberFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const formatReading = (value: number, unit: string) => `${numberFormat.format(value)}${unit ? ` ${unit}` : ""}`;

export function EnvironmentReadingsChart({
  variable, series, hiddenKeys, points, range, timeWindow, ariaLabel,
}: EnvironmentReadingsChartProps) {
  const visible = series
    .map((entry, index) => ({ entry, stroke: seriesStroke(index) }))
    .filter(({ entry }) => !hiddenKeys?.has(entry.key));
  const config: ChartConfig = Object.fromEntries(visible.map(({ entry, stroke }) => [entry.key, {
    label: entry.label,
    color: stroke.color,
  }]));
  const tickPattern = range === "7d" ? "dd/MM HH:mm" : "HH:mm";

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-[220px] w-full sm:h-[260px]"
      role="img"
      aria-label={ariaLabel ?? `Historial de ${variable.name} por sensor del establecimiento`}
    >
      <LineChart accessibilityLayer data={points} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={timeWindow ? [timeWindow.start, timeWindow.end] : ["dataMin", "dataMax"]}
          tickFormatter={(value: number) => format(new Date(value), tickPattern)}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(value: number) => formatReading(value, variable.unit)}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <ChartTooltip
          content={(
            <ChartTooltipContent
              // "dot" keeps the time label on one-item payloads; the formatter draws its own series marker.
              indicator="dot"
              labelFormatter={(_, payload) => {
                const time = payload?.[0]?.payload?.time;
                return typeof time === "number" ? format(new Date(time), "PP p", { locale: es }) : null;
              }}
              formatter={(value, name, item) => typeof value === "number" ? (
                <div className="flex w-full items-center gap-2">
                  <span className="h-2.5 w-1 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="flex-1 text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatReading(value, variable.unit)}</span>
                </div>
              ) : null}
            />
          )}
        />
        {visible.map(({ entry, stroke }) => (
          <Line
            key={entry.key}
            dataKey={entry.key}
            name={entry.key}
            type="monotone"
            stroke={`var(--color-${entry.key})`}
            strokeDasharray={stroke.dash}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
