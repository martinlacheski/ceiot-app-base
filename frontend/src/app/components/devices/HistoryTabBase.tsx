import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HistoryResultsTable, type HistoryColumn } from "./HistoryResultsTable";
import { useResettingPage } from "./historyTabState";
import { isHistoryForbidden, isHistoryNotFound } from "./historyErrors";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { useListFilters } from "@/hooks/useListFilters";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { downloadReport } from "@/lib/downloadReport";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { useAuthStore } from "@/auth/store/auth.store";
import type { HistoryPage } from "@/api/deviceHistory.api";

export interface HistoryTabBaseProps<T extends { time: string }> {
  kind: "telemetry" | "operations";
  serial: string;
  environmentId: string;
  dateFrom?: string;
  dateTo?: string;
  dateSelector: ReactNode;
  columns: HistoryColumn<T>[];
  filterFields: (setFilter: (key: string, value?: string) => void, filters: Record<string, string>) => ReactNode;
  fetchRows: (params: { search?: string; sortBy: string; sortOrder: "asc" | "desc"; page: number; perPage: number; dateFrom?: string; dateTo?: string; filters: Record<string, string> }) => Promise<HistoryPage<T>>;
  mobile: (rows: T[]) => ReactNode;
}
export function HistoryTabBase<T extends { time: string }>({ kind, serial, environmentId, dateFrom, dateTo, dateSelector, columns, filterFields, fetchRows, mobile }: HistoryTabBaseProps<T>) {
  const user = useAuthStore((state) => state.user);
  const searchBox = useDebouncedSearch();
  const filtersPanel = useListFilters();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({ sortBy: "time", sortOrder: "desc" });
  const search = searchBox.debounced.trim().slice(0, 64) || undefined;
  const resetKey = JSON.stringify([search, filters, sort, dateFrom, dateTo]);
  const { pagination, setPagination } = useResettingPage(resetKey);
  const query = useQuery({
    queryKey: ["device-history", kind, serial, environmentId, search, filters, sort, dateFrom, dateTo, pagination],
    queryFn: () => fetchRows({ search, ...sort, dateFrom, dateTo,
      page: pagination.pageIndex + 1, perPage: pagination.pageSize, filters }),
    placeholderData: keepPreviousData,
  });
  const setFilter = (key: string, value?: string) => setFilters((previous) => {
    const next = { ...previous };
    if (value) next[key] = value; else delete next[key];
    return next;
  });
  const exportRows = async (format: "excel" | "pdf") => {
    const rows = await fetchAllPages((page, perPage) => fetchRows({ search, ...sort, dateFrom, dateTo, page, perPage, filters }));
    await downloadReport(format, { title: kind === "telemetry" ? `Telemetría: ${serial}` : `Operaciones: ${serial}`, filename: `${kind}-${serial}`, generatedBy: getExportGeneratedBy(user), columns: columns.map((column) => column.title), data: rows.map((row) => columns.map((column) => String(column.value(row)))) });
  };
  return <div className="space-y-3">
    <ListToolbarLayout search={<ListSearchInput value={searchBox.value} onChange={searchBox.setValue} onClear={searchBox.clear} />} primaryActions={<><ListFiltersTrigger open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={Object.keys(filters).length > 0} />{dateSelector}</>} />
    <ListFiltersPanel open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={Object.keys(filters).length > 0} onReset={() => { setFilters({}); searchBox.clear(); setSort({ sortBy: "time", sortOrder: "desc" }); }}>{filterFields(setFilter, filters)}</ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {kind === "telemetry" && !query.isError && !query.isPending && query.data?.total === 0 && <p role="status" className="text-muted-foreground">No hay lecturas disponibles. Los invitados solo pueden consultar operaciones.</p>}
    {query.isError ? isHistoryForbidden(query.error) ? <p role="alert" className="text-muted-foreground">No tenés acceso a la telemetría de este dispositivo.</p> : isHistoryNotFound(query.error) ? <p role="alert">Sin historial para este dispositivo.</p> : <ListErrorState message="No se pudo cargar el historial." onRetry={() => query.refetch()} /> : <HistoryResultsTable items={query.data?.items || []} columns={columns} sort={sort} onSort={setSort} pagination={pagination} onPagination={setPagination} total={query.data?.total || 0} mobile={mobile(query.data?.items || [])} />}
  </div>;
}
