import { Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READINGS_RANGES, type ReadingsRange } from "./overviewModel";

export type ReadingsView = "device" | "environment";

const VIEWS: Array<{ id: ReadingsView; label: string }> = [
  { id: "device", label: "Por dispositivo" },
  { id: "environment", label: "Por establecimiento" },
];

export function Notice({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <p className="font-medium">{title}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export function TelemetryPermissionNotice() {
  return (
    <Notice icon={Lock} title="Tu usuario no tiene permiso para ver lecturas.">
      <p className="text-sm text-muted-foreground">Pedile a un administrador el permiso de telemetría.</p>
    </Notice>
  );
}

export function ReadingsViewToggle({ view, onViewChange }: { view: ReadingsView; onViewChange: (view: ReadingsView) => void }) {
  return (
    <div role="group" aria-label="Vista de lecturas" className="inline-flex rounded-md border bg-card p-0.5 shadow-sm">
      {VIEWS.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={view === option.id ? "secondary" : "ghost"}
          aria-pressed={view === option.id}
          className="h-8 px-3"
          onClick={() => onViewChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function RangePresets({ range, onRangeChange }: { range: ReadingsRange; onRangeChange: (range: ReadingsRange) => void }) {
  return (
    <div role="group" aria-label="Período de lecturas" className="inline-flex rounded-md border p-0.5">
      {READINGS_RANGES.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={range === option.id ? "secondary" : "ghost"}
          aria-pressed={range === option.id}
          aria-label={option.description}
          title={option.description}
          className="h-8 px-3 tabular-nums"
          onClick={() => onRangeChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
