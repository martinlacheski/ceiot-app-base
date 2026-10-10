import { Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { TelemetryVariable } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READINGS_RANGES, type ReadingsRange } from "./overviewModel";

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

function SegmentedToggle<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ id: T; label: string; description?: string }>;
  value: T;
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

export function RangePresets({ range, onRangeChange }: { range: ReadingsRange; onRangeChange: (range: ReadingsRange) => void }) {
  return <SegmentedToggle label="Período de lecturas" options={READINGS_RANGES} value={range} onChange={onRangeChange} />;
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
