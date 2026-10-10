import { Link } from "react-router";

import { formatTelemetryValue } from "@/app/components/devices/historyTelemetryColumns";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/utils/date.utils";

interface RecentRecordsCardProps {
  deviceId: string;
  deviceName: string;
  page?: TelemetryPage;
  isLoading: boolean;
  isError: boolean;
}

export function RecentRecordsCard({ deviceId, deviceName, page, isLoading, isError }: RecentRecordsCardProps) {
  const items = page?.items ?? [];
  const columns = (page?.sensors ?? []).flatMap((sensor) => sensor.variables.map((variable) => ({
    id: `${sensor.key}:${variable.code}`,
    sensorKey: sensor.key,
    code: variable.code,
    title: `${sensor.sensorName} · ${variable.name}${variable.unit ? ` (${variable.unit})` : ""}`,
  })));

  return (
    <Card role="region" aria-labelledby="overview-records-title" className="gap-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle id="overview-records-title">Últimos registros</CardTitle>
          <CardDescription className="truncate">Lecturas más recientes de {deviceName}</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to={`/app/devices/${deviceId}`}>Ver historial completo</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Cargando registros…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">No se pudieron cargar los registros.</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay registros para este dispositivo.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">Hora</TableHead>
                {columns.map((column) => <TableHead key={column.id} className="text-right">{column.title}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.time}>
                  <TableCell className="sticky left-0 bg-card text-muted-foreground tabular-nums">
                    <time dateTime={item.time}>{formatDateTime(item.time, "dd/MM HH:mm:ss")}</time>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.id} className="text-right tabular-nums">
                      {formatTelemetryValue(item.values[column.sensorKey]?.[column.code], "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
