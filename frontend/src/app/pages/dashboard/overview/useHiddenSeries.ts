import { useState } from "react";

import type { EnvironmentSeries } from "./environmentSeries";

type SeriesIdentity = Pick<EnvironmentSeries, "deviceId" | "sensorKey">;

/** Stable identity of a series across data updates; chart keys (`s0..sN`) follow the series order instead. */
export const seriesId = (series: SeriesIdentity) => `${series.deviceId}:${series.sensorKey}`;

export interface HiddenSeries {
  /** Chart keys of the hidden series of the current list. */
  hiddenKeys: ReadonlySet<string>;
  hiddenCount: number;
  isHidden: (series: SeriesIdentity) => boolean;
  /** False for the last visible series: at least one stays on screen. */
  canHide: (series: SeriesIdentity) => boolean;
  toggle: (id: string) => void;
  showAll: () => void;
}

/**
 * Series the user hid from the legend, keyed by device and sensor so they survive refreshes,
 * variable changes and reordering. Ids of series that disappear are forgotten, and when every
 * remaining series ended up hidden they are all shown again. An empty list (loading) keeps the state.
 */
export function useHiddenSeries(series: EnvironmentSeries[]): HiddenSeries {
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const present = new Set(series.map(seriesId));
  let current = hiddenIds.filter((id) => present.has(id));
  if (current.length >= present.size) current = [];
  if (series.length > 0 && current.length !== hiddenIds.length) {
    setHiddenIds(current);
  }

  const hidden = new Set(series.length > 0 ? current : []);
  const visibleCount = series.length - hidden.size;

  return {
    hiddenKeys: new Set(series.filter((entry) => hidden.has(seriesId(entry))).map((entry) => entry.key)),
    hiddenCount: hidden.size,
    isHidden: (entry) => hidden.has(seriesId(entry)),
    canHide: (entry) => !hidden.has(seriesId(entry)) && visibleCount > 1,
    toggle: (id) => {
      if (hidden.has(id)) setHiddenIds(current.filter((hiddenId) => hiddenId !== id));
      else if (present.has(id) && visibleCount > 1) setHiddenIds([...current, id]);
    },
    showAll: () => setHiddenIds([]),
  };
}
