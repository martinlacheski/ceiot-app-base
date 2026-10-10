import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;

interface KpiPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the details card. */
  label: string;
  busy?: boolean;
  /** Tile content; the whole tile is the trigger. */
  tile: ReactNode;
  children: ReactNode;
}

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * A KPI tile whose details open like a hover card for mouse users and on click, tap,
 * Enter or Space for everyone else. Clicking a hover-opened card keeps it open.
 */
export function KpiPopover({ open, onOpenChange, label, busy, tile, children }: KpiPopoverProps) {
  const timer = useRef<number | undefined>(undefined);
  // True when the card was opened on purpose (click, tap, keyboard): pointer moves do not close it.
  const pinned = useRef(false);

  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const schedule = (next: boolean, delay: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onOpenChange(next);
    }, delay);
  };
  useEffect(() => clearTimer, []);

  const handlePointerEnter = (event: PointerEvent) => {
    if (!isMouse(event)) return;
    clearTimer();
    if (open) return;
    pinned.current = false;
    schedule(true, OPEN_DELAY_MS);
  };
  const handlePointerLeave = (event: PointerEvent) => {
    if (!isMouse(event)) return;
    clearTimer();
    if (open && !pinned.current) schedule(false, CLOSE_DELAY_MS);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        clearTimer();
        // Opening through Radix is deliberate; on close keep the flag so onCloseAutoFocus can read it.
        if (next) pinned.current = true;
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-busy={busy || undefined}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onClick={(event) => {
            if (open && !pinned.current) {
              // Radix would toggle the hover-opened card closed; keep it open and pinned instead.
              event.preventDefault();
              clearTimer();
              pinned.current = true;
            }
          }}
          className={cn(
            "flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm transition-colors",
            "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent/50",
          )}
        >
          {tile}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onOpenAutoFocus={(event) => {
          // A hover preview must not steal focus; a deliberate open moves focus into the card.
          if (!pinned.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Closing a hover preview must not move focus to the tile.
          if (!pinned.current) event.preventDefault();
          pinned.current = false;
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
