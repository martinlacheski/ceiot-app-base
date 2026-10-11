import { useState } from "react";

import { useMountEffect } from "@/app/hooks/useMountEffect";

/** Rolling windows advance once a minute, enough for the finest (1 minute) bucket. */
export const NOW_TICK_MS = 60_000;

/** Reads the wall clock outside render bodies (render must stay pure). */
const readClock = () => Date.now();

/**
 * The current time, refreshed every `NOW_TICK_MS`. Lets rolling windows move forward
 * while a quiet device sends nothing that would otherwise trigger a render.
 */
export function useNow(): number {
  const [now, setNow] = useState(readClock);
  useMountEffect(() => {
    const timer = window.setInterval(() => setNow(readClock()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  });
  return now;
}
