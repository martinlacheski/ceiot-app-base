import type { EnvironmentSeries } from "./environmentSeries";
import { seriesStroke } from "./environmentSeries";
import { seriesId, type HiddenSeries } from "./useHiddenSeries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SeriesLegendProps {
  series: EnvironmentSeries[];
  hidden: HiddenSeries;
}

/** Interactive legend: each entry shows or hides its series in the chart and the table. */
export function SeriesLegend({ series, hidden }: SeriesLegendProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <div role="group" aria-label="Series del gráfico" className="flex flex-wrap gap-1">
        {series.map((entry, index) => {
          const stroke = seriesStroke(index);
          const isHidden = hidden.isHidden(entry);
          const locked = !isHidden && !hidden.canHide(entry);
          return (
            <button
              key={seriesId(entry)}
              type="button"
              aria-pressed={!isHidden}
              disabled={locked}
              title={locked ? "Tiene que quedar al menos una serie visible" : isHidden ? "Mostrar serie" : "Ocultar serie"}
              onClick={() => hidden.toggle(seriesId(entry))}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground transition-colors",
                "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:bg-transparent",
                isHidden && "text-muted-foreground",
              )}
            >
              <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true" className={cn("shrink-0", isHidden && "opacity-30")}>
                <line x1="1" y1="4" x2="15" y2="4" stroke={stroke.color} strokeWidth="2" strokeDasharray={stroke.dash} strokeLinecap="round" />
              </svg>
              <span className={cn(isHidden && "line-through")}>{entry.label}</span>
            </button>
          );
        })}
      </div>
      {hidden.hiddenCount > 0 && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={hidden.showAll}>
          Mostrar todos
        </Button>
      )}
    </div>
  );
}
