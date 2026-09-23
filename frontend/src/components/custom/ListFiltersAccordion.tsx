import { Filter } from "lucide-react";
import type { ReactNode } from "react";

import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FILTERS_ITEM = "advance-filters";

interface ListFiltersTriggerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasActiveFilters?: boolean;
}

/** The "Filtros" button, with a "!" badge while any filter is active. */
export function ListFiltersTrigger({
  open,
  onOpenChange,
  hasActiveFilters = false,
}: ListFiltersTriggerProps) {
  return (
    <Button variant={open ? "secondary" : "default"} onClick={() => onOpenChange(!open)}>
      <Filter data-icon="inline-start" />
      Filtros
      {hasActiveFilters ? (
        <Badge variant="secondary" className="ml-2">
          !
        </Badge>
      ) : null}
    </Button>
  );
}

interface ListFiltersPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasActiveFilters?: boolean;
  /** Resets search, filters and sorting; the button shows only while filters are active. */
  onReset: () => void;
  /** Extra classes for the fields grid (breakpoint columns, e.g. "lg:grid-cols-4"). */
  className?: string;
  children: ReactNode;
}

/** Collapsible "Filtros avanzados" panel holding the screen's own filter fields. */
export function ListFiltersPanel({
  open,
  onOpenChange,
  hasActiveFilters = false,
  onReset,
  className,
  children,
}: ListFiltersPanelProps) {
  return (
    <Accordion
      type="single"
      collapsible
      value={open ? FILTERS_ITEM : ""}
      onValueChange={(value) => onOpenChange(value === FILTERS_ITEM)}
    >
      <AccordionItem value={FILTERS_ITEM} className="border-none">
        <AccordionContent>
          <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Filtros avanzados</h3>
              {hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={onReset}>
                  Limpiar todos
                </Button>
              ) : null}
            </div>
            <div
              className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}
              data-testid="list-filters-fields"
            >
              {children}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
