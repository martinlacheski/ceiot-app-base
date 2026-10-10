import { format } from "date-fns";

import { formatTelemetryValue } from "@/app/components/devices/historyTelemetryColumns";
import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { latestPoints, type EnvironmentPoint, type EnvironmentSeries } from "./environmentSeries";
import type { ReadingsRange } from "./overviewModel";

/** Rows shown by the table view; older buckets stay in the chart. */
export const SERIES_TABLE_ROWS = 20;

interface SeriesTableProps {
  variable: TelemetryVariable;
  series: EnvironmentSeries[];
  points: EnvironmentPoint[];
  range: ReadingsRange;
}

/** The merged buckets of the chart as rows, newest first, one column per series. */
export function SeriesTable({ variable, series, points, range }: SeriesTableProps) {
  const timePattern = range === "7d" ? "dd/MM HH:mm" : "HH:mm";
  const unit = variable.unit ? ` (${variable.unit})` : "";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 bg-card">Hora</TableHead>
          {series.map((entry) => <TableHead key={entry.key} className="text-right">{entry.label}{unit}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {latestPoints(points, SERIES_TABLE_ROWS).map((point) => (
          <TableRow key={point.time}>
            <TableCell className="sticky left-0 bg-card text-muted-foreground tabular-nums">
              <time dateTime={new Date(point.time).toISOString()}>{format(new Date(point.time), timePattern)}</time>
            </TableCell>
            {series.map((entry) => (
              <TableCell key={entry.key} className="text-right tabular-nums">
                {formatTelemetryValue(point[entry.key], "")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
