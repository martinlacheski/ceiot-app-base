import { useState } from "react";

export function useResettingPage(resetKey: string, defaultPageSize = 10) {
  const [state, setState] = useState({ pageIndex: 0, pageSize: defaultPageSize, resetKey });
  const stale = state.resetKey !== resetKey;
  if (stale) setState({ ...state, pageIndex: 0, resetKey });
  return {
    pagination: { pageIndex: stale ? 0 : state.pageIndex, pageSize: state.pageSize },
    setPagination: (next: { pageIndex: number; pageSize: number }) => setState({ ...next, resetKey }),
  };
}

export function parseHistoryNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function filterHistoryDateRange<T extends { time: string }>(rows: T[], from?: string, to?: string): T[] {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const date = new Date(row.time);
    if (Number.isNaN(date.getTime())) return false;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return (!from || day >= from) && (!to || day <= to);
  });
}
