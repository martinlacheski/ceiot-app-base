import { LineChart as LineChartIcon } from "lucide-react";

import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Skeleton } from "@/components/ui/skeleton";
import { EnvironmentReadingsChart } from "./EnvironmentReadingsChart";
import type { EnvironmentPoint, EnvironmentSeries } from "./environmentSeries";
import type { ReadingsRange } from "./overviewModel";
import type { ReadingsDisplay, ReadingsView } from "./ReadingsControls";
import { SeriesTable } from "./SeriesTable";

/** Bucketed history of the active view (one device or every device of an establishment). */
export interface SeriesReadingsState {
  loading: boolean;
  failedDevices: number;
  deviceCount: number;
  variables: TelemetryVariable[];
  variable?: TelemetryVariable;
  series: EnvironmentSeries[];
  points: EnvironmentPoint[];
  bucketLabel: string;
}

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
  range: ReadingsRange;
  readings: SeriesReadingsState;
}

/** Chart or merged-bucket table for the selected variable, with loading, failure and empty states. */
export function SeriesReadingsBody({ scope, display, range, readings }: SeriesReadingsBodyProps) {
  const { loading, failedDevices, deviceCount, variable, series, points, bucketLabel } = readings;
  const copy = COPY[scope];
  const hasData = Boolean(variable) && series.length > 0 && points.length > 0;

  if (loading && !hasData) {
    return (
      <div role="status" aria-label={copy.loading}>
        <Skeleton className="h-[220px] w-full sm:h-[260px]" />
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
    `promedio cada ${bucketLabel}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-2">
      {failure}
      {display === "table" ? (
        <SeriesTable variable={variable} series={series} points={points} range={range} />
      ) : (
        <EnvironmentReadingsChart
          variable={variable}
          series={series}
          points={points}
          range={range}
          ariaLabel={`Historial de ${variable.name} por sensor ${copy.noun}`}
        />
      )}
      <p className="text-xs text-muted-foreground">{summary}</p>
    </div>
  );
}
