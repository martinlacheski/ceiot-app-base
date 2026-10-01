import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import type { DailyTelemetry, TelemetryItem, TelemetrySensor } from "@/app/types/environmentalSensor.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadReport } from "@/lib/downloadReport";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { formatDateTime } from "@/utils/date.utils";
import { HistoryResultsTable } from "./HistoryResultsTable";
import { useResettingPage } from "./historyTabState";
import { buildTelemetryColumns, formatTelemetryValue, mergeTelemetrySensors } from "./historyTelemetryColumns";
import {
  DAILY_REPORT_TITLE, DETAILED_REPORT_TITLE, NO_READINGS_MESSAGE, buildDailyExport, buildDetailedExport,
  dailyReadings, formatDailyDate, localUtcOffsetMinutes, reportFilename, reportSubtitle, sensorVariableTitle,
} from "./deviceTelemetryReport";

interface TelemetryTableProps {
  device: { id: string; name?: string | null; serial: string };
  /** ISO instants delimiting the report period. */
  start: string;
  end: string;
}

const STAT_LABELS: Array<["min" | "max" | "avg", string]> = [["min", "Mín"], ["max", "Máx"], ["avg", "Prom"]];

export function DeviceDailySummary({ device, start, end }: TelemetryTableProps) {
  const user = useAuthStore((state) => state.user);
  const offset = localUtcOffsetMinutes(new Date(end));
  const query = useQuery({
    queryKey: ["telemetry", "daily", device.id, start, end, offset],
    queryFn: () => environmentalSensorService.getDaily(device.id, start, end, offset),
    placeholderData: keepPreviousData,
  });
  const exportRows = async (format: "excel" | "pdf") => {
    const { columns, data } = buildDailyExport(query.data as DailyTelemetry);
    await downloadReport(format, {
      title: DAILY_REPORT_TITLE, filename: reportFilename("daily", device.serial, start, end),
      subtitle: reportSubtitle(device, start, end), generatedBy: getExportGeneratedBy(user), columns, data,
    });
  };
  const days = query.data?.days ?? [];
  const sensors = query.data?.sensors ?? [];
  return <div className="space-y-3">
    <ListExportActions onExport={exportRows} disabled={!days.length} />
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Cargando resumen diario…</p>}
    {query.isError && <ListErrorState message="No se pudo cargar el resumen diario." onRetry={() => query.refetch()} />}
    {!query.isPending && !query.isError && !days.length && <p role="status" className="text-sm text-muted-foreground">{NO_READINGS_MESSAGE}</p>}
    {days.length > 0 && <DailyTable days={days} sensors={sensors} />}
  </div>;
}

function DailyTable({ days, sensors }: DailyTelemetry) {
  const cell = (day: DailyTelemetry["days"][number], sensorKey: string, code: string, stat: "min" | "max" | "avg", unit: string) =>
    formatTelemetryValue(day.sensors[sensorKey]?.[code]?.[stat], unit);
  return <>
    <div className="hidden overflow-x-auto rounded-md border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={2} className="text-center">Fecha</TableHead>
            {sensors.flatMap((sensor) => sensor.variables.map((variable) =>
              <TableHead key={`${sensor.key}:${variable.code}`} colSpan={3} className="whitespace-normal border-l text-center">{sensorVariableTitle(sensor, variable)}</TableHead>))}
            <TableHead rowSpan={2} className="border-l text-center">Lecturas</TableHead>
          </TableRow>
          <TableRow>
            {sensors.flatMap((sensor) => sensor.variables.flatMap((variable) =>
              STAT_LABELS.map(([stat, label]) => <TableHead key={`${sensor.key}:${variable.code}:${stat}`} className={`text-center ${stat === "min" ? "border-l" : ""}`}>{label}</TableHead>)))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((day) => <TableRow key={day.date}>
            <TableCell className="text-center font-medium">{formatDailyDate(day.date)}</TableCell>
            {sensors.flatMap((sensor) => sensor.variables.flatMap((variable) =>
              STAT_LABELS.map(([stat]) => <TableCell key={`${sensor.key}:${variable.code}:${stat}`} className={`text-center tabular-nums ${stat === "min" ? "border-l" : ""}`}>{cell(day, sensor.key, variable.code, stat, variable.unit)}</TableCell>)))}
            <TableCell className="border-l text-center tabular-nums">{dailyReadings(day)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    <div className="grid gap-3 md:hidden" aria-label="Resumen diario en tarjetas">
      {days.map((day) => <Card key={day.date} role="article">
        <CardHeader><CardTitle className="text-base">{formatDailyDate(day.date)}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {sensors.flatMap((sensor) => sensor.variables.map((variable) => <Fragment key={`${sensor.key}:${variable.code}`}>
            <div>
              <p className="font-medium">{sensorVariableTitle(sensor, variable)}</p>
              <p className="tabular-nums text-muted-foreground">
                {STAT_LABELS.map(([stat, label]) => `${label}: ${cell(day, sensor.key, variable.code, stat, variable.unit)}`).join(" · ")}
              </p>
            </div>
          </Fragment>))}
          <p className="text-muted-foreground">Lecturas: <span className="tabular-nums">{dailyReadings(day)}</span></p>
        </CardContent>
      </Card>)}
    </div>
  </>;
}

const FIXED_SORT = { sortBy: "time", sortOrder: "desc" } as const;

export function DeviceDetailedReadings({ device, start, end }: TelemetryTableProps) {
  const user = useAuthStore((state) => state.user);
  const { pagination, setPagination } = useResettingPage(JSON.stringify([device.id, start, end]));
  const query = useQuery({
    queryKey: ["telemetry", "detailed", device.id, start, end, pagination],
    queryFn: () => environmentalSensorService.getHistory(device.id, start, end, pagination.pageIndex + 1, pagination.pageSize),
    placeholderData: keepPreviousData,
  });
  const exportRows = async (format: "excel" | "pdf") => {
    let allSensors: TelemetrySensor[] = [];
    const rows = await fetchAllPages<TelemetryItem>(async (page, perPage) => {
      const result = await environmentalSensorService.getHistory(device.id, start, end, page, perPage);
      allSensors = mergeTelemetrySensors(allSensors, result.sensors);
      return result;
    });
    const { columns, data } = buildDetailedExport(rows, allSensors);
    await downloadReport(format, {
      title: DETAILED_REPORT_TITLE, filename: reportFilename("detailed", device.serial, start, end),
      subtitle: reportSubtitle(device, start, end), generatedBy: getExportGeneratedBy(user), columns, data,
    });
  };
  const rows = query.data?.items ?? [];
  const columns = buildTelemetryColumns(query.data?.sensors ?? []).map((column, index) =>
    index === 0 ? { ...column, title: "Fecha y hora", sortable: false } : column);
  const mobile = <div className="grid gap-3 md:hidden" aria-label="Lecturas de telemetría en tarjetas">
    {rows.map((row, index) => <Card key={`${row.time}-${index}`} role="article">
      <CardHeader><CardTitle className="text-base">{formatDateTime(row.time)}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">{columns.slice(1).map((column) => <p key={column.id}>{column.title}: {column.value(row)}</p>)}</CardContent>
    </Card>)}
  </div>;
  return <div className="space-y-3">
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Cargando lecturas…</p>}
    {query.isError && <ListErrorState message="No se pudieron cargar las lecturas." onRetry={() => query.refetch()} />}
    {!query.isPending && !query.isError && query.data?.total === 0 && <p role="status" className="text-sm text-muted-foreground">{NO_READINGS_MESSAGE}</p>}
    {!query.isError && !!query.data?.total && <HistoryResultsTable items={rows} columns={columns} sort={FIXED_SORT} onSort={() => undefined}
      pagination={pagination} onPagination={setPagination} total={query.data.total} mobile={mobile} entityName="lecturas" />}
  </div>;
}
