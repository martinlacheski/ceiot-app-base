import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { deviceHistoryApi, type HistoryTelemetryItem, type HistoryTelemetrySensor } from "@/api/deviceHistory.api";
import { ListNumberFilter, ListSelectFilter } from "@/components/custom/ListFilterFields";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { useListFilters } from "@/hooks/useListFilters";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { downloadReport } from "@/lib/downloadReport";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { formatDateTime } from "@/utils/date.utils";
import { useAuthStore } from "@/auth/store/auth.store";
import { HistoryResultsTable } from "./HistoryResultsTable";
import { useResettingPage, parseHistoryNumber } from "./historyTabState";
import { isHistoryForbidden, isHistoryNotFound } from "./historyErrors";
import { buildTelemetryColumns, mergeTelemetrySensors } from "./historyTelemetryColumns";

export function HistoryTelemetryTab({ serial, environmentId, dateFrom, dateTo, dateSelector }: { serial: string; environmentId: string; dateFrom?: string; dateTo?: string; dateSelector: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const canReadCatalog = Boolean(user?.isAdmin || user?.permissions?.includes("sensor_catalog:read"));
  const searchBox = useDebouncedSearch();
  const filtersPanel = useListFilters();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ sortBy: "time"; sortOrder: "asc" | "desc" }>({ sortBy: "time", sortOrder: "desc" });
  const search = searchBox.debounced.trim().slice(0, 64) || undefined;
  const { pagination, setPagination } = useResettingPage(JSON.stringify([search, filters, sort, dateFrom, dateTo]));
  const fetchRows = (page: number, perPage: number) => deviceHistoryApi.telemetry(serial, {
    environmentId, search, ...sort, dateFrom, dateTo, page, perPage,
    variable: filters.variable,
    min: filters.variable ? parseHistoryNumber(filters.min || "") : undefined,
    max: filters.variable ? parseHistoryNumber(filters.max || "") : undefined,
  });
  const query = useQuery({
    queryKey: ["device-history", "telemetry", serial, environmentId, search, filters, sort, dateFrom, dateTo, pagination],
    queryFn: () => fetchRows(pagination.pageIndex + 1, pagination.pageSize),
    placeholderData: keepPreviousData,
    enabled: canReadTelemetry,
  });
  const catalog = useQuery({
    queryKey: ["sensor-catalog", "variables"],
    queryFn: deviceHistoryApi.variables,
    enabled: canReadTelemetry && canReadCatalog,
  });
  const sensors = query.data?.sensors || [];
  const [knownSensors, setKnownSensors] = useState<HistoryTelemetrySensor[]>([]);
  useEffect(() => {
    if (query.data?.sensors.length) setKnownSensors((previous) => mergeTelemetrySensors(previous, query.data!.sensors));
  }, [query.data]);
  const columns = buildTelemetryColumns(sensors);
  const variables = [...new Map([
    ...(catalog.data || []),
    ...knownSensors.flatMap((sensor) => sensor.variables),
  ].map((variable) => [variable.code, { value: variable.code, label: `${variable.name}${variable.unit ? ` (${variable.unit})` : ""}` }])).values()];
  const setFilter = (key: string, value?: string) => setFilters((previous) => {
    const next = { ...previous };
    if (value) next[key] = value; else delete next[key];
    if (key === "variable" && !value) { delete next.min; delete next.max; }
    return next;
  });
  const exportRows = async (format: "excel" | "pdf") => {
    let allSensors: HistoryTelemetrySensor[] = [];
    const rows = await fetchAllPages(async (page, perPage) => {
      const result = await fetchRows(page, perPage);
      allSensors = mergeTelemetrySensors(allSensors, result.sensors);
      return result;
    });
    const exportColumns = buildTelemetryColumns(allSensors);
    await downloadReport(format, {
      title: `Telemetría: ${serial}`, filename: `telemetry-${serial}`,
      generatedBy: getExportGeneratedBy(user),
      columns: exportColumns.map((column) => column.title),
      data: rows.map((row) => exportColumns.map((column) => String(column.value(row)))),
    });
  };
  const mobile = (rows: HistoryTelemetryItem[]) => <div className="grid gap-3 md:hidden" aria-label="Lecturas de telemetría en tarjetas">
    {rows.map((row, index) => <Card key={`${row.time}-${index}`} role="article"><CardHeader><CardTitle>{formatDateTime(row.time)}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
      {columns.slice(1).map((column) => <p key={column.id}>{column.title}: {column.value(row)}</p>)}
    </CardContent></Card>)}
  </div>;
  if (!canReadTelemetry) return <p role="alert" className="text-muted-foreground">No tienes acceso a la telemetría de este dispositivo.</p>;
  return <div className="space-y-3">
    <ListToolbarLayout search={<ListSearchInput value={searchBox.value} onChange={searchBox.setValue} onClear={searchBox.clear} />} primaryActions={<><ListFiltersTrigger open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={Object.keys(filters).length > 0} />{dateSelector}</>} />
    <ListFiltersPanel open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={Object.keys(filters).length > 0} onReset={() => { setFilters({}); searchBox.clear(); setSort({ sortBy: "time", sortOrder: "desc" }); }}>
      <ListSelectFilter label="Variable" value={filters.variable} onChange={(value) => setFilter("variable", value)} options={variables} />
      {(!canReadCatalog || catalog.isError) && <p className="text-sm text-muted-foreground">Solo se muestran las variables de los registros cargados.</p>}
      {filters.variable && <><ListNumberFilter label="Valor mínimo" value={filters.min || ""} onChange={(value) => setFilter("min", value)} /><ListNumberFilter label="Valor máximo" value={filters.max || ""} onChange={(value) => setFilter("max", value)} /></>}
    </ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {!query.isError && !query.isPending && query.data?.total === 0 && <p role="status" className="text-muted-foreground">No hay registros de telemetría para los filtros seleccionados.</p>}
    {query.isPending && <p role="status" className="text-muted-foreground">Cargando telemetría...</p>}
    {query.isError ? isHistoryForbidden(query.error) ? <p role="alert" className="text-muted-foreground">No tienes acceso a la telemetría de este dispositivo.</p> : isHistoryNotFound(query.error) ? <p role="alert">Sin historial para este dispositivo.</p> : <ListErrorState message="No se pudo cargar la telemetría." onRetry={() => query.refetch()} /> :
      <HistoryResultsTable items={query.data?.items || []} columns={columns} sort={sort} onSort={(next) => setSort({ sortBy: "time", sortOrder: next.sortOrder })} pagination={pagination} onPagination={setPagination} total={query.data?.total || 0} mobile={mobile(query.data?.items || [])} />}
  </div>;
}
