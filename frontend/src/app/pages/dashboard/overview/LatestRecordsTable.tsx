import { Link } from "react-router";

import { formatTelemetryValue } from "@/app/components/devices/historyTelemetryColumns";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/utils/date.utils";

interface LatestRecordsTableProps {
  deviceId: string;
  page?: TelemetryPage;
  isLoading: boolean;
  isError: boolean;
}

/** Most recent raw readings of one device, one column per sensor variable. */
export function LatestRecordsTable({ deviceId, page, isLoading, isError }: LatestRecordsTableProps) {
  const items = page?.items ?? [];
  const columns = (page?.sensors ?? []).flatMap((sensor) => sensor.variables.map((variable) => ({
    id: `${sensor.key}:${variable.code}`,
    sensorKey: sensor.key,
    code: variable.code,
    title: `${sensor.sensorName} · ${variable.name}${variable.unit ? ` (${variable.unit})` : ""}`,
  })));

  return (
    <div className="space-y-2">
      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Cargando registros…</p>
      ) : isError && !page ? (
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
      <div className="flex justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/app/devices/${deviceId}`}>Ver historial completo</Link>
        </Button>
      </div>
    </div>
  );
}
