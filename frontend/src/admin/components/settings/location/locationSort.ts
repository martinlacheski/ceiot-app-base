import type { SortingState } from "@tanstack/react-table";
import { useEffect } from "react";

import type { ListSortDirection } from "@/components/custom/ListSortControls";

export const COUNTRY_SORT_OPTIONS = [
  { value: "name", label: "Nombre" },
  { value: "isActive", label: "Estado" },
] as const;

export const STATE_SORT_OPTIONS = [
  { value: "name", label: "Nombre" },
  { value: "countryName", label: "País" },
  { value: "isActive", label: "Estado" },
] as const;

export const CITY_SORT_OPTIONS = [
  { value: "name", label: "Nombre" },
  { value: "stateName", label: "Provincia" },
  { value: "countryName", label: "País" },
  { value: "postalCode", label: "Código Postal" },
  { value: "isActive", label: "Estado" },
] as const;

export type CountrySortField = (typeof COUNTRY_SORT_OPTIONS)[number]["value"];
export type StateSortField = (typeof STATE_SORT_OPTIONS)[number]["value"];
export type CitySortField = (typeof CITY_SORT_OPTIONS)[number]["value"];
export interface LocationSort<TField extends string = string> {
  field: TField;
  direction: ListSortDirection;
}

export function parseLocationSort<TField extends string>(
  raw: string | null,
  options: readonly { value: TField }[],
): { sort: LocationSort<TField> | undefined; isValid: boolean } {
  if (raw === null) return { sort: undefined, isValid: true };
  const parts = raw.split(":");
  const field = parts[0] as TField;
  const direction = parts[1] as ListSortDirection;
  const isValid =
    parts.length === 2 &&
    options.some((option) => option.value === field) &&
    (direction === "asc" || direction === "desc");
  return isValid
    ? { sort: { field, direction }, isValid: true }
    : { sort: undefined, isValid: false };
}

export function serializeLocationSort(sort?: LocationSort): string | undefined {
  return sort ? `${sort.field}:${sort.direction}` : undefined;
}

export function toSortingState(sort?: LocationSort): SortingState {
  return sort ? [{ id: sort.field, desc: sort.direction === "desc" }] : [];
}

export function useNormalizeInvalidLocationSort(
  isValid: boolean,
  normalize: () => void,
) {
  useEffect(() => {
    if (!isValid) normalize();
  }, [isValid, normalize]);
}
