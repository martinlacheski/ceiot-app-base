import { format } from "date-fns";

import { formatTelemetryValue } from "@/app/components/devices/historyTelemetryColumns";
import type { AggregateBucket, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { latestPoints, pointValue, type EnvironmentPoint, type EnvironmentSeries } from "./environmentSeries";

/** Rows shown by the table view; older buckets stay in the chart. */
export const SERIES_TABLE_ROWS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeriesTableProps {
  variable: TelemetryVariable;
  series: EnvironmentSeries[];
  points: EnvironmentPoint[];
  /** Bucket of the rows: daily buckets show the date only. */
  bucket?: AggregateBucket;
  /** Span of the window: beyond a day, rows show the date too. */
  spanMs: number;
}

/** The aggregated buckets of the chart as rows, newest first, one column per series. */
export function SeriesTable({ variable, series, points, bucket, spanMs }: SeriesTableProps) {
  const timePattern = bucket === "1d" ? "dd/MM/yy" : spanMs > DAY_MS ? "dd/MM HH:mm" : "HH:mm";
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
                {formatTelemetryValue(pointValue(point, entry.key), "")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
