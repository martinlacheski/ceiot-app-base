import { format } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { DateTimePicker24h } from "@/components/custom/DateTimePicker24h";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  canShiftForward,
  periodWindow,
  presetPeriod,
  READINGS_RANGES,
  shiftPeriod,
  validateCustomRange,
  type ReadingsPeriod,
} from "./overviewModel";
import { SegmentedToggle } from "./ReadingsControls";

interface PeriodControlsProps {
  period: ReadingsPeriod;
  /** Current time (refreshed every minute); prev/next and the custom draft start from it. */
  now: number;
  onPeriodChange: (period: ReadingsPeriod) => void;
  /** Back to the live preset last used. */
  onLive: () => void;
}

const MINUTE_MS = 60_000;
const minuteFloor = (time: number) => new Date(Math.floor(time / MINUTE_MS) * MINUTE_MS);

/** Short label of a fixed window: the date only once when both bounds share the day. */
function windowLabel(start: number, end: number) {
  const sameDay = format(start, "yyyyMMdd") === format(end, "yyyyMMdd");
  return `${format(start, "dd/MM HH:mm")} – ${format(end, sameDay ? "HH:mm" : "dd/MM HH:mm")}`;
}

/** "Personalizado": a popover with from/to date-time pickers (24h), validated before it applies. */
function CustomPeriodPicker({ period, now, onPeriodChange }: Omit<PeriodControlsProps, "onLive">) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [error, setError] = useState<string | null>(null);
  const custom = period.kind === "custom";
  const label = custom ? windowLabel(period.start, period.end) : null;

  const onOpenChange = (next: boolean) => {
    if (next) {
      // The draft starts from the window on screen.
      const { start, end } = periodWindow(period, now);
      setFrom(minuteFloor(start));
      setTo(minuteFloor(end));
      setError(null);
    }
    setOpen(next);
  };

  const apply = () => {
    const invalid = validateCustomRange(from, to);
    setError(invalid);
    if (invalid || !from || !to) return;
    onPeriodChange({ kind: "custom", start: from.getTime(), end: to.getTime() });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={custom ? "secondary" : "outline"}
          aria-pressed={custom}
          aria-label={label ? `Personalizado: ${label}` : "Personalizado"}
          className="h-9 tabular-nums"
        >
          <CalendarRange data-icon="inline-start" aria-hidden="true" />
          {label ?? "Personalizado"}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Período personalizado" align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-3">
        <p className="text-sm font-medium">Período personalizado</p>
        <div className="space-y-1">
          <Label htmlFor="readings-period-from" className="text-xs">Desde</Label>
          <DateTimePicker24h id="readings-period-from" value={from} onChange={setFrom} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="readings-period-to" className="text-xs">Hasta</Label>
          <DateTimePicker24h id="readings-period-to" value={to} onChange={setTo} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" size="sm" onClick={apply}>Aplicar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Rolling presets, a custom window and prev/next by the window's own span. */
export function PeriodControls({ period, now, onPeriodChange, onLive }: PeriodControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedToggle
        label="Período de lecturas"
        options={READINGS_RANGES}
        value={period.kind === "preset" ? period.range : null}
        onChange={(range) => onPeriodChange(presetPeriod(range))}
      />
      <CustomPeriodPicker period={period} now={now} onPeriodChange={onPeriodChange} />
      <div role="group" aria-label="Navegar períodos" className="inline-flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Período anterior"
          title="Período anterior"
          onClick={() => onPeriodChange(shiftPeriod(period, -1, now))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Período siguiente"
          title="Período siguiente"
          disabled={!canShiftForward(period, now)}
          onClick={() => onPeriodChange(shiftPeriod(period, 1, now))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        {period.kind === "custom" && (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onLive}>
            Ahora
          </Button>
        )}
      </div>
    </div>
  );
}
