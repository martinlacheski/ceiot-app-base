import { format } from "date-fns";
import { es } from "date-fns/locale";

import type { TelemetryPage, TelemetrySensor, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EnvironmentalReadingsChart } from "./charts/EnvironmentalReadingsChart";

interface EnvironmentalReadingsSectionProps {
  latest?: TelemetryPage;
  history?: TelemetryPage;
  isLoading?: boolean;
  isError?: boolean;
  latestLoading?: boolean;
  historyLoading?: boolean;
  latestError?: boolean;
  historyError?: boolean;
  className?: string;
}

const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export function EnvironmentalReadingsSection({ latest, history, isLoading, isError, latestLoading, historyLoading, latestError, historyError, className }: EnvironmentalReadingsSectionProps) {
  const loadingCurrent = latestLoading ?? isLoading ?? false;
  const loadingHistory = historyLoading ?? isLoading ?? false;
  const errorCurrent = latestError ?? isError ?? false;
  const errorHistory = historyError ?? isError ?? false;
  const latestItem = latest?.items[0];
  const sensors = latest?.sensors ?? [];
  const variables = new Map<string, { variable: TelemetryVariable; sensors: TelemetrySensor[] }>();
  for (const sensor of history?.sensors ?? []) {
    for (const variable of sensor.variables) {
      const entry = variables.get(variable.code) ?? { variable, sensors: [] };
      entry.sensors.push(sensor);
      variables.set(variable.code, entry);
    }
  }
  const fullyLoading = loadingCurrent && loadingHistory;
  const fullyError = errorCurrent && errorHistory;
  const fullyEmpty = !loadingCurrent && !loadingHistory && !errorCurrent && !errorHistory && !latestItem && !history?.items.length;

  return <Card className={className}>
    <CardHeader><CardTitle className="text-lg">Lecturas ambientales</CardTitle><CardDescription>Valores actuales e historial reciente del dispositivo.</CardDescription></CardHeader>
    <CardContent className="space-y-6">
      {fullyLoading ? <p className="text-sm text-muted-foreground">Cargando lecturas ambientales…</p>
        : fullyError ? <p className="text-sm text-destructive" role="alert">No se pudieron cargar las lecturas ambientales.</p>
        : fullyEmpty ? <p className="text-sm text-muted-foreground">Aún no hay lecturas ambientales.</p>
        : <>
          {loadingCurrent ? <p className="text-sm text-muted-foreground">Cargando valores actuales…</p>
            : errorCurrent ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar los valores actuales.</p>
            : latestItem ? <div className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-2">
                {sensors.filter((sensor) => latestItem.values[sensor.key]).map((sensor) => <div key={sensor.key} className="rounded-md border p-3">
                  <p className="font-medium">{sensor.sensorName} <span className="text-xs text-muted-foreground">· {sensor.key}</span></p>
                  <div className="mt-1 space-y-1 text-sm">{sensor.variables.map((variable) => {
                    const value = latestItem.values[sensor.key]?.[variable.code];
                    return <p key={variable.code}>{variable.name}: <span className="tabular-nums">{typeof value === "number" ? `${numberFormatter.format(value)} ${variable.unit}` : "Sin dato"}</span></p>;
                  })}</div>
                </div>)}
              </div>
              <p className="text-xs text-muted-foreground">Última lectura: <time dateTime={latestItem.time}>{format(new Date(latestItem.time), "PP p", { locale: es })}</time></p>
            </div> : <p className="text-sm text-muted-foreground">No hay valores actuales.</p>}
          {loadingHistory ? <p className="text-sm text-muted-foreground">Cargando historial de lecturas…</p>
            : errorHistory ? <p role="alert" className="text-sm text-destructive">No se pudo cargar el historial de lecturas.</p>
            : history?.items.length ? Array.from(variables, ([code, { variable, sensors: series }]) => <div key={code}>
              <h3 className="mb-2 text-sm font-medium">{variable.name} ({variable.unit})</h3>
              <EnvironmentalReadingsChart readings={history.items} variableCode={code} sensors={series} />
            </div>) : <p className="text-sm text-muted-foreground">No hay lecturas en el período seleccionado.</p>}
        </>}
    </CardContent>
  </Card>;
}
