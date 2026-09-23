import type { SortingState, Updater } from "@tanstack/react-table";

export type SortOrder = "asc" | "desc";

/** Sort as the backend takes it: `sort_by` + `sort_order`. Column ids equal `sort_by` values. */
export interface ServerSort<TSortBy extends string> {
  sortBy: TSortBy;
  sortOrder: SortOrder;
}

export const isSortOrder = (value: string | null | undefined): value is SortOrder =>
  value === "asc" || value === "desc";

/** The (always single-column) sorting state a table shows for a server sort. */
export const toSortingState = <T extends string>(sort: ServerSort<T>): SortingState => [
  { id: sort.sortBy, desc: sort.sortOrder === "desc" },
];

/**
 * Resolves a TanStack `onSortingChange` updater into the next server sort.
 * An empty sorting (header "Reset") or a column the server cannot sort by
 * falls back to the screen's default sort.
 */
export function applySortingUpdate<T extends string>(
  updater: Updater<SortingState>,
  current: ServerSort<T>,
  allowed: readonly T[],
  fallback: ServerSort<T>,
): ServerSort<T> {
  const next = typeof updater === "function" ? updater(toSortingState(current)) : updater;
  const first = next[0];
  if (!first || !(allowed as readonly string[]).includes(first.id)) return fallback;
  return { sortBy: first.id as T, sortOrder: first.desc ? "desc" : "asc" };
}
