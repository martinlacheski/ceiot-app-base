import { LineChart as LineChartIcon } from "lucide-react";

import type { AggregateBucket, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EnvironmentReadingsChart } from "./EnvironmentReadingsChart";
import type { EnvironmentPoint, EnvironmentSeries } from "./environmentSeries";
import { AGGREGATE_FUNCTIONS, BUCKET_LABEL, type AggregateFunction, type ReadingsWindow } from "./overviewModel";
import type { ReadingsDisplay, ReadingsView } from "./ReadingsControls";
import { SeriesLegend } from "./SeriesLegend";
import { SeriesTable } from "./SeriesTable";
import type { HiddenSeries } from "./useHiddenSeries";

/** Aggregated readings of the active view (one device or every device of an establishment). */
export interface SeriesReadingsState {
  loading: boolean;
  failedDevices: number;
  deviceCount: number;
  variables: TelemetryVariable[];
  variable?: TelemetryVariable;
  series: EnvironmentSeries[];
  points: EnvironmentPoint[];
  /** Bucket of the shown data, as resolved by the server. */
  bucket?: AggregateBucket;
  /** Bucket statistic plotted as the value. */
  fn: AggregateFunction;
  /** Window the X axis spans (rolling or fixed). */
  timeWindow: ReadingsWindow;
  /** Identifies the shown window (view, target, period, bucket): the chart zoom resets when it changes. */
  windowKey: string;
  /** The data of a previous period or establishment, kept on screen while the new one loads. */
  stale?: boolean;
}

const functionLabel = (fn: AggregateFunction) =>
  (AGGREGATE_FUNCTIONS.find((entry) => entry.id === fn)?.label ?? "").toLowerCase();

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

const COPY: Record<ReadingsView, { noun: string; loading: string; empty: string }> = {
  device: {
    noun: "del dispositivo",
    loading: "Cargando lecturas del dispositivo",
    empty: "No hay lecturas de este dispositivo en el período elegido.",
  },
  environment: {
    noun: "del establecimiento",
    loading: "Cargando lecturas del establecimiento",
    empty: "No hay lecturas de este establecimiento en el período elegido.",
  },
};

interface SeriesReadingsBodyProps {
  scope: ReadingsView;
  display: ReadingsDisplay;
  readings: SeriesReadingsState;
  /** Series hidden from the legend; they leave the chart, its tooltip and the table. */
  hidden: HiddenSeries;
  /** Shade the min–max band of the visible series. */
  showBand: boolean;
}

/** Chart or merged-bucket table for the selected variable, with loading, failure and empty states. */
export function SeriesReadingsBody({ scope, display, readings, hidden, showBand }: SeriesReadingsBodyProps) {
  const { loading, failedDevices, deviceCount, variable, series, points, bucket, fn, timeWindow, windowKey, stale } = readings;
  const copy = COPY[scope];
  const hasData = Boolean(variable) && series.length > 0 && points.length > 0;

  if (loading && !hasData) {
    return (
      <div role="status" aria-label={copy.loading}>
        <Skeleton className="h-[244px] w-full sm:h-[284px]" />
      </div>
    );
  }

  const failure = failedDevices > 0 && (
    <p role="alert" className="text-sm text-destructive">
      {scope === "device"
        ? "No pudimos cargar el historial de lecturas del dispositivo."
        : `No pudimos cargar las lecturas de ${failedDevices} dispositivo(s).`}
    </p>
  );

  if (!hasData || !variable) {
    return (
      <div className="space-y-3">
        {failure}
        {failedDevices < deviceCount && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <LineChartIcon className="size-5" aria-hidden="true" />
            <p className="text-sm">{copy.empty}</p>
          </div>
        )}
      </div>
    );
  }

  const summary = [
    scope === "environment" ? plural(deviceCount, "dispositivo", "dispositivos") : null,
    plural(series.length, "sensor", "sensores"),
    bucket ? `${functionLabel(fn)} cada ${BUCKET_LABEL[bucket]}` : null,
  ].filter(Boolean).join(" · ");

  return (
    // Dimmed, not replaced, while the next range or establishment loads: no layout shift.
    <div className={cn("space-y-2 transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
      {failure}
      {display === "table" ? (
        <SeriesTable
          variable={variable}
          series={series.filter((entry) => !hidden.hiddenKeys.has(entry.key))}
          points={points}
          bucket={bucket}
          spanMs={timeWindow.end - timeWindow.start}
        />
      ) : (
        <EnvironmentReadingsChart
          key={windowKey}
          variable={variable}
          series={series}
          hiddenKeys={hidden.hiddenKeys}
          points={points}
          timeWindow={timeWindow}
          showBand={showBand}
          ariaLabel={`Historial de ${variable.name} por sensor ${copy.noun}`}
        />
      )}
      {series.length > 1 && <SeriesLegend series={series} hidden={hidden} />}
      <p className="text-xs text-muted-foreground">{summary}</p>
    </div>
  );
}
