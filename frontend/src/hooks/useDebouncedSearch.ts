import { useCallback, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";

/**
 * Local search text plus its debounced copy. Bind `value` to the input and use
 * `debounced` to drive server requests or URL params.
 */
export function useDebouncedSearch(initial = "", delayMs = 300) {
  const [value, setValue] = useState(initial);
  const debounced = useDebouncedValue(value, delayMs);
  const clear = useCallback(() => setValue(""), []);

  return { value, debounced, setValue, clear };
}
