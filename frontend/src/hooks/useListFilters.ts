import { useState } from "react";

/** Open/closed state shared by `ListFiltersTrigger` and `ListFiltersPanel`. */
export function useListFilters(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  return { open, setOpen, toggle: () => setOpen((current) => !current) };
}
