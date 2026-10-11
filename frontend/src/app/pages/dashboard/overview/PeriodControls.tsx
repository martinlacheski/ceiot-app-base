import { endOfDay, startOfDay } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
  /** Current time (refreshed every minute); prev/next and the custom range start from it. */
  now: number;
  onPeriodChange: (period: ReadingsPeriod) => void;
  /** Back to the live preset last used. */
  onLive: () => void;
}

/** A custom period of whole local days, like the device detail page. */
const dayPeriod = (from: Date, to: Date): Extract<ReadingsPeriod, { kind: "custom" }> => ({
  kind: "custom",
  start: startOfDay(from).getTime(),
  end: endOfDay(to).getTime(),
});

/** Rolling presets, a custom range of days (shared DateRangePicker) and prev/next by the window's own span. */
export function PeriodControls({ period, now, onPeriodChange, onLive }: PeriodControlsProps) {
  const [error, setError] = useState<string | null>(null);
  const custom = period.kind === "custom";

  const changePeriod = (next: ReadingsPeriod) => {
    setError(null);
    onPeriodChange(next);
  };

  const startCustom = () => {
    // Starts from the window on screen, widened to whole days.
    const { start, end } = periodWindow(period, now);
    changePeriod(dayPeriod(new Date(start), new Date(end)));
  };

  const pickDays = (from: Date, to: Date | undefined) => {
    const next = dayPeriod(from, to ?? from);
    const invalid = validateCustomRange(new Date(next.start), new Date(next.end));
    if (invalid) {
      setError(invalid);
      return;
    }
    changePeriod(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedToggle
        label="Período de lecturas"
        options={READINGS_RANGES}
        value={period.kind === "preset" ? period.range : null}
        onChange={(range) => changePeriod(presetPeriod(range))}
      />
      <Button
        type="button"
        size="sm"
        variant={custom ? "secondary" : "outline"}
        aria-pressed={custom}
        className="h-9"
        onClick={() => !custom && startCustom()}
      >
        <CalendarRange data-icon="inline-start" aria-hidden="true" />
        Personalizado
      </Button>
      {period.kind === "custom" && (
        <DateRangePicker
          key={`${period.start}|${period.end}`}
          initialDateFrom={new Date(period.start)}
          initialDateTo={new Date(period.end)}
          align="start"
          locale="es"
          showCompare={false}
          mobileLayout
          triggerClassName="w-full sm:w-auto"
          onUpdate={({ range }) => range.from && pickDays(range.from, range.to)}
        />
      )}
      <div role="group" aria-label="Navegar períodos" className="inline-flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Período anterior"
          title="Período anterior"
          onClick={() => changePeriod(shiftPeriod(period, -1, now))}
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
          onClick={() => changePeriod(shiftPeriod(period, 1, now))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        {period.kind === "custom" && (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setError(null); onLive(); }}>
            Ahora
          </Button>
        )}
      </div>
      {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}
