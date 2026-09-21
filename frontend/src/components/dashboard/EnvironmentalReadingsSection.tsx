import { format } from "date-fns";
import { es } from "date-fns/locale";

import type { SensorReadingListResponse } from "@/app/types/sensorReading.types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { EnvironmentalReadingsChart } from "./charts/EnvironmentalReadingsChart";

interface EnvironmentalReadingsSectionProps {
  latest?: SensorReadingListResponse;
  history?: SensorReadingListResponse;
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

const numberFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 1,
  useGrouping: false,
});

const formatMeasurement = (value: number | null, unit: string) =>
  value === null ? "Sin dato" : `${numberFormatter.format(value)} ${unit}`;

export function EnvironmentalReadingsSection({
  latest,
  history,
  isLoading,
  isError,
  className,
}: EnvironmentalReadingsSectionProps) {
  const latestReading = latest?.items[0];
  const historyReadings = history?.items ?? [];
  const isEmpty = !latestReading && historyReadings.length === 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Lecturas ambientales</CardTitle>
        <CardDescription>
          Valores actuales e historial reciente del dispositivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Cargando lecturas ambientales…
          </p>
        ) : isError ? (
          <p className="text-sm text-destructive" role="alert">
            No se pudieron cargar las lecturas ambientales.
          </p>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay lecturas ambientales.
          </p>
        ) : (
          <>
            {latestReading && (
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-sm font-medium">Temperatura</p>
                    <p className="text-lg tabular-nums">
                      {formatMeasurement(latestReading.temperatureC, "°C")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Humedad relativa</p>
                    <p className="text-lg tabular-nums">
                      {formatMeasurement(
                        latestReading.relativeHumidityPct,
                        "%",
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Presión</p>
                    <p className="text-lg tabular-nums">
                      {formatMeasurement(latestReading.pressureHpa, "hPa")}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Última lectura:{" "}
                  <time dateTime={latestReading.time}>
                    {format(new Date(latestReading.time), "PP p", {
                      locale: es,
                    })}
                  </time>
                </p>
              </div>
            )}
            {historyReadings.length > 0 && (
              <EnvironmentalReadingsChart readings={historyReadings} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
