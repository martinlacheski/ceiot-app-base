export interface PageResult<T> {
  items: T[];
  total: number;
}

/**
 * Fetches every row of a server-paginated list (used by exports). Requests page 1
 * with `perPage` and, when `total` exceeds it, requests the remaining pages in order.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, perPage: number) => Promise<PageResult<T>>,
  { perPage = 10000 }: { perPage?: number } = {},
): Promise<T[]> {
  const first = await fetchPage(1, perPage);
  const all = [...first.items];
  const pages = Math.ceil(first.total / perPage);

  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPage(page, perPage);
    if (next.items.length === 0) break;
    all.push(...next.items);
  }

  return all;
}
