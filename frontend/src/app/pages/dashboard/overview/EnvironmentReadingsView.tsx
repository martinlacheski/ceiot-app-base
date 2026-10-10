import { Building2, LineChart as LineChartIcon } from "lucide-react";

import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EnvironmentReadingsChart } from "./EnvironmentReadingsChart";
import type { EnvironmentPoint, EnvironmentSeries } from "./environmentSeries";
import type { ReadingsRange } from "./overviewModel";
import { Notice, RangePresets, TelemetryPermissionNotice } from "./ReadingsControls";

export interface EnvironmentReadingsState {
  loading: boolean;
  failedDevices: number;
  deviceCount: number;
  variables: TelemetryVariable[];
  variable?: TelemetryVariable;
  series: EnvironmentSeries[];
  points: EnvironmentPoint[];
  bucketLabel: string;
}

interface EnvironmentReadingsViewProps {
  environments: Array<{ id: string; name: string }>;
  selectedEnvironmentId?: string;
  onSelectEnvironment: (environmentId: string) => void;
  range: ReadingsRange;
  onRangeChange: (range: ReadingsRange) => void;
  onSelectVariable: (variableCode: string) => void;
  canReadTelemetry: boolean;
  readings: EnvironmentReadingsState;
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

function VariableChips({ variables, selected, onSelect }: {
  variables: TelemetryVariable[];
  selected?: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div role="group" aria-label="Variable" className="flex flex-wrap gap-2">
      {variables.map((variable) => (
        <Button
          key={variable.code}
          type="button"
          size="sm"
          variant={selected === variable.code ? "secondary" : "outline"}
          aria-pressed={selected === variable.code}
          className="h-8 rounded-full px-3"
          onClick={() => onSelect(variable.code)}
        >
          {variable.name}{variable.unit ? ` (${variable.unit})` : ""}
        </Button>
      ))}
    </div>
  );
}

function ChartBody({ readings, range }: { readings: EnvironmentReadingsState; range: ReadingsRange }) {
  const { loading, failedDevices, deviceCount, variable, series, points, bucketLabel } = readings;
  const hasChart = Boolean(variable) && series.length > 0 && points.length > 0;

  if (loading && !hasChart) {
    return (
      <div role="status" aria-label="Cargando lecturas del establecimiento">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failedDevices > 0 && (
        <p role="alert" className="text-sm text-destructive">
          No pudimos cargar las lecturas de {failedDevices} dispositivo(s).
        </p>
      )}
      {hasChart && variable ? (
        <>
          <EnvironmentReadingsChart variable={variable} series={series} points={points} range={range} />
          <p className="text-xs text-muted-foreground">
            {plural(deviceCount, "dispositivo", "dispositivos")} · {plural(series.length, "sensor", "sensores")} · promedio cada {bucketLabel}
          </p>
        </>
      ) : failedDevices < deviceCount && (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <LineChartIcon className="size-5" aria-hidden="true" />
          <p className="text-sm">No hay lecturas de este establecimiento en el período elegido.</p>
        </div>
      )}
    </div>
  );
}

export function EnvironmentReadingsView(props: EnvironmentReadingsViewProps) {
  const { environments, selectedEnvironmentId, onSelectEnvironment, range, onRangeChange, onSelectVariable, canReadTelemetry, readings } = props;

  if (environments.length === 0) {
    return (
      <Notice icon={Building2} title="Ningún dispositivo está asignado a un establecimiento.">
        <p className="max-w-sm text-sm text-muted-foreground">
          Asigná tus dispositivos a un establecimiento para comparar sus sensores en un solo gráfico.
        </p>
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="overview-environment" className="text-xs font-medium text-muted-foreground">Establecimiento</label>
          <select
            id="overview-environment"
            className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:max-w-sm"
            value={selectedEnvironmentId}
            onChange={(event) => onSelectEnvironment(event.target.value)}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>{environment.name}</option>
            ))}
          </select>
        </div>
        <RangePresets range={range} onRangeChange={onRangeChange} />
      </div>
      {canReadTelemetry ? (
        <Card>
          <CardContent className="space-y-4">
            {readings.variables.length > 0 && (
              <VariableChips variables={readings.variables} selected={readings.variable?.code} onSelect={onSelectVariable} />
            )}
            <ChartBody readings={readings} range={range} />
          </CardContent>
        </Card>
      ) : (
        <TelemetryPermissionNotice />
      )}
    </div>
  );
}
