import { Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AggregateBucket, TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AGGREGATE_FUNCTIONS,
  AGGREGATION_LEVELS,
  aggregationAllowed,
  BAND_MAX_SERIES,
  BUCKET_LABEL,
  type AggregateFunction,
  type AggregationLevel,
} from "./overviewModel";

export type ReadingsView = "device" | "environment";
export type ReadingsDisplay = "chart" | "table";

const VIEWS: Array<{ id: ReadingsView; label: string }> = [
  { id: "device", label: "Por dispositivo" },
  { id: "environment", label: "Por establecimiento" },
];

const DISPLAYS: Array<{ id: ReadingsDisplay; label: string }> = [
  { id: "chart", label: "Gráfico" },
  { id: "table", label: "Tabla" },
];

/** Icon, title and optional body, without a card around it (for use inside another card). */
export function NoticeContent({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}

export function Notice(props: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <NoticeContent {...props} />
      </CardContent>
    </Card>
  );
}

export function TelemetryPermissionNotice() {
  return (
    <NoticeContent icon={Lock} title="Tu usuario no tiene permiso para ver lecturas.">
      <p className="text-sm text-muted-foreground">Pedile a un administrador el permiso de telemetría.</p>
    </NoticeContent>
  );
}

/** Buttons where one (or none, with a null value) is pressed. */
export function SegmentedToggle<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ id: T; label: string; description?: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-md border p-0.5">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={value === option.id ? "secondary" : "ghost"}
          aria-pressed={value === option.id}
          aria-label={option.description}
          title={option.description}
          className="h-8 px-3 tabular-nums"
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function ReadingsViewToggle({ view, onViewChange }: { view: ReadingsView; onViewChange: (view: ReadingsView) => void }) {
  return <SegmentedToggle label="Vista de lecturas" options={VIEWS} value={view} onChange={onViewChange} />;
}

export function DisplayToggle({ display, onDisplayChange }: {
  display: ReadingsDisplay;
  onDisplayChange: (display: ReadingsDisplay) => void;
}) {
  return <SegmentedToggle label="Formato de lecturas" options={DISPLAYS} value={display} onChange={onDisplayChange} />;
}

const SELECT_CLASS = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm";

/** Bucket size: automatic (showing the bucket the server resolved) or an explicit level that fits the span. */
export function AggregationSelect({ value, resolved, spanMs, onChange }: {
  value: AggregationLevel;
  /** Bucket the server used for the data on screen. */
  resolved?: AggregateBucket;
  spanMs: number;
  onChange: (level: AggregationLevel) => void;
}) {
  return (
    <div className="min-w-36">
      <label htmlFor="readings-aggregation" className="sr-only">Nivel de agregación</label>
      <select
        id="readings-aggregation"
        className={SELECT_CLASS}
        value={value}
        title="Nivel de agregación"
        onChange={(event) => onChange(event.target.value as AggregationLevel)}
      >
        {AGGREGATION_LEVELS.map((level) => (
          // Levels that exceed the server's bucket cap for this span cannot be requested.
          <option key={level.id} value={level.id} disabled={!aggregationAllowed(level.id, spanMs)}>
            {level.id === "auto" && resolved ? `${level.label} · ${BUCKET_LABEL[resolved]}` : level.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FunctionToggle({ value, onChange }: { value: AggregateFunction; onChange: (fn: AggregateFunction) => void }) {
  return <SegmentedToggle label="Función de agregación" options={AGGREGATE_FUNCTIONS} value={value} onChange={onChange} />;
}

/** Shows or hides the bucket min–max band; unavailable with too many visible series. */
export function BandToggle({ checked, available, onChange }: {
  checked: boolean;
  available: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hint = available ? undefined : `El rango se muestra con hasta ${BAND_MAX_SERIES} series visibles`;
  return (
    <div className="flex items-center gap-2" title={hint}>
      <Switch id="readings-band" checked={checked && available} disabled={!available} onCheckedChange={onChange} />
      <Label htmlFor="readings-band" className="text-xs font-normal text-muted-foreground">Mostrar rango mín–máx</Label>
    </div>
  );
}

export function VariableChips({ variables, selected, onSelect }: {
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
          className="h-7 rounded-full px-3"
          onClick={() => onSelect(variable.code)}
        >
          {variable.name}{variable.unit ? ` (${variable.unit})` : ""}
        </Button>
      ))}
    </div>
  );
}
