import { useQuery } from "@tanstack/react-query";

import { catalogApi } from "./catalogApi";

/** Variable options for selects; the list and the form share this cache entry, always as an array. */
export function useVariableOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-catalog", "variable-options"],
    queryFn: async () => (await catalogApi.list("variables", { page: 1, perPage: 10000 })).items,
    enabled,
  });
}
