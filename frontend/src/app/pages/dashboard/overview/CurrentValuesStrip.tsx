import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import { formatTelemetryValue } from "@/app/components/devices/historyTelemetryColumns";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { collectCurrentValues } from "./currentValues";

interface CurrentValuesStripProps {
  page?: TelemetryPage;
  isLoading: boolean;
  isError: boolean;
  selectedVariable?: string;
  onSelectVariable: (code: string) => void;
}

/** "Última lectura hace X"; a device clock slightly ahead must not read as "en X minutos". */
function lastReadingLabel(time: string): string {
  const date = new Date(Math.min(Date.parse(time), Date.now()));
  return `Última lectura ${formatDistanceToNow(date, { addSuffix: true, locale: es })}`;
}

/** Latest value of every sensor variable as one wrapping row of small items. */
export function CurrentValuesStrip({ page, isLoading, isError, selectedVariable, onSelectVariable }: CurrentValuesStripProps) {
  if (isLoading) return <Skeleton aria-label="Cargando valores actuales" className="h-8 w-full max-w-md" />;
  if (isError && !page) {
    return <p role="alert" className="text-sm text-destructive">No se pudieron cargar los valores actuales.</p>;
  }

  const { values, lastTime } = collectCurrentValues(page);
  if (values.length === 0) return null;
  const showSensor = (page?.sensors.length ?? 0) > 1;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ul aria-label="Valores actuales" className="flex flex-wrap gap-2">
        {values.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              title={`Ver ${entry.variable.name} en el gráfico`}
              className={cn(
                "flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-muted",
                selectedVariable === entry.variable.code && "border-primary/40 bg-muted",
              )}
              onClick={() => onSelectVariable(entry.variable.code)}
            >
              <span className="text-muted-foreground">
                {entry.variable.name}{showSensor ? ` · ${entry.sensorName}` : ""}
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {formatTelemetryValue(entry.value, entry.variable.unit)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {lastTime && <p className="text-xs text-muted-foreground">{lastReadingLabel(lastTime)}</p>}
    </div>
  );
}
