import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { Area, Brush, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { bandKey, seriesStroke, type EnvironmentPoint, type EnvironmentSeries } from "./environmentSeries";
import type { ReadingsWindow } from "./overviewModel";

interface EnvironmentReadingsChartProps {
  variable: TelemetryVariable;
  /** Every series of the variable; the position fixes its color, so hiding one never repaints the rest. */
  series: EnvironmentSeries[];
  /** Chart keys left out of the lines, the bands, the tooltip and the Y domain. */
  hiddenKeys?: ReadonlySet<string>;
  points: EnvironmentPoint[];
  /** Window shown on the X axis; without it the axis fits the data. */
  timeWindow?: ReadingsWindow;
  /** Shade the bucket min–max of every visible series behind its line. */
  showBand?: boolean;
  /** Accessible name; defaults to the establishment wording. */
  ariaLabel?: string;
}

/** Zoomed time range, kept by time (not index) so it survives new buckets and trimmed old ones. */
interface ZoomRange {
  from: number;
  to: number;
}

const HOUR_MS = 60 * 60 * 1000;
const BAND_OPACITY = 0.14;

const numberFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const formatNumber = (value: number) => numberFormat.format(value);
const formatReading = (value: number, unit: string) => `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;

/** Axis tick pattern for the shown span: hours for a day, day and hour for a week, days beyond. */
function tickPattern(span: number) {
  if (span <= 36 * HOUR_MS) return "HH:mm";
  if (span <= 8 * 24 * HOUR_MS) return "dd/MM HH:mm";
  return "dd/MM";
}

/** Brush indices of the zoomed range in the current points; the whole series when not zoomed. */
function brushIndices(points: EnvironmentPoint[], zoom: ZoomRange | null) {
  const last = points.length - 1;
  if (!zoom) return { startIndex: 0, endIndex: last };
  const first = points.findIndex((point) => point.time >= zoom.from);
  const startIndex = first === -1 ? 0 : first;
  let endIndex = last;
  while (endIndex > startIndex && points[endIndex].time > zoom.to) endIndex -= 1;
  return { startIndex, endIndex };
}

export function EnvironmentReadingsChart({
  variable, series, hiddenKeys, points, timeWindow, showBand = false, ariaLabel,
}: EnvironmentReadingsChartProps) {
  const [zoom, setZoom] = useState<ZoomRange | null>(null);
  const visible = series
    .map((entry, index) => ({ entry, stroke: seriesStroke(index) }))
    .filter(({ entry }) => !hiddenKeys?.has(entry.key));
  const config: ChartConfig = Object.fromEntries(visible.map(({ entry, stroke }) => [entry.key, {
    label: entry.label,
    color: stroke.color,
  }]));

  const zoomable = points.length >= 2;
  const { startIndex, endIndex } = brushIndices(points, zoomable ? zoom : null);
  // A zoom narrowed to a single bucket has no span to draw: show the whole window instead.
  const zoomed = zoomable && zoom !== null && endIndex > startIndex;
  const domain: [number, number] | ["dataMin", "dataMax"] = zoomed
    ? [points[startIndex].time, points[endIndex].time]
    : timeWindow ? [timeWindow.start, timeWindow.end] : ["dataMin", "dataMax"];
  const span = typeof domain[0] === "number" && typeof domain[1] === "number"
    ? domain[1] - domain[0]
    : (points.at(-1)?.time ?? 0) - (points[0]?.time ?? 0);
  const pattern = tickPattern(span);
  const formatTick = (value: number) => format(new Date(value), pattern);

  const onBrushChange = (range: { startIndex?: number; endIndex?: number }) => {
    const { startIndex: start, endIndex: end } = range;
    if (start === undefined || end === undefined || !points[start] || !points[end]) return;
    setZoom(start === 0 && end === points.length - 1 ? null : { from: points[start].time, to: points[end].time });
  };

  return (
    <div className="relative">
      {zoomed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute top-0 right-0 z-10 h-7 bg-background/90 px-2 text-xs"
          onClick={() => setZoom(null)}
        >
          Restablecer zoom
        </Button>
      )}
      <ChartContainer
        config={config}
        className="aspect-auto h-[244px] w-full sm:h-[284px]"
        role="img"
        aria-label={ariaLabel ?? `Historial de ${variable.name} por sensor del establecimiento`}
      >
        <ComposedChart accessibilityLayer data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={domain}
            allowDataOverflow={typeof domain[0] === "number"}
            tickFormatter={formatTick}
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
                formatter={(value, name, item) => {
                  if (typeof value !== "number") return null;
                  const band = showBand ? (item.payload as EnvironmentPoint | undefined)?.[bandKey(String(name))] : null;
                  return (
                    <div className="flex w-full flex-col gap-0.5">
                      <div className="flex w-full items-center gap-2">
                        <span className="h-2.5 w-1 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
                        <span className="flex-1 text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">{formatReading(value, variable.unit)}</span>
                      </div>
                      {Array.isArray(band) && (
                        <div className="flex w-full items-center gap-2 pl-3 text-muted-foreground">
                          <span className="flex-1">mín–máx</span>
                          <span className="font-mono tabular-nums">{`${formatNumber(band[0])} – ${formatNumber(band[1])}`}</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            )}
          />
          {showBand && visible.map(({ entry }) => (
            <Area
              key={`${entry.key}-band`}
              dataKey={bandKey(entry.key)}
              type="monotone"
              stroke="none"
              fill={`var(--color-${entry.key})`}
              fillOpacity={BAND_OPACITY}
              activeDot={false}
              legendType="none"
              tooltipType="none"
              connectNulls
              isAnimationActive={false}
            />
          ))}
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
          {zoomable && (
            <Brush
              dataKey="time"
              height={20}
              travellerWidth={8}
              startIndex={startIndex}
              endIndex={endIndex}
              onChange={onBrushChange}
              tickFormatter={formatTick}
              stroke="var(--muted-foreground)"
              fill="var(--background)"
              aria-label="Acercar un tramo del gráfico"
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
