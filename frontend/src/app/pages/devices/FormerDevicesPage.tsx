import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { deviceHistoryApi, type HistoryDevice } from "@/api/deviceHistory.api";
import { environmentService } from "@/app/services/environment.service";
import { getUsersAction } from "@/admin/actions/user.actions";
import { PageHeader } from "@/app/components/PageHeader";
import { HistoryResultsTable, type HistoryColumn } from "@/app/components/devices/HistoryResultsTable";
import { useAuthStore } from "@/auth/store/auth.store";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListSelectFilter } from "@/components/custom/ListFilterFields";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { useListFilters } from "@/hooks/useListFilters";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { downloadReport } from "@/lib/downloadReport";
import { formatDateTime } from "@/utils/date.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";

const sorts = ["serial", "device_name", "environment_name", "owner_name", "first_seen", "last_seen", "readings_count", "operations_count"];
export default function FormerDevicesPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useSearchParams();
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const user = useAuthStore((state) => state.user);
  const filtersPanel = useListFilters();
  const searchBox = useDebouncedSearch(url.get("search") || "");
  const page = toPositiveInt(url.get("page"), 1);
  const perPage = toPositiveInt(url.get("size"), 10);
  const sortBy = sorts.includes(url.get("sort_by") || "") ? url.get("sort_by")! : "last_seen";
  const sortOrder: "asc" | "desc" = url.get("sort_order") === "asc" ? "asc" : "desc";
  const ownerId = isAdmin ? url.get("owner_id") || undefined : undefined;
  const environmentId = url.get("environment_id") || undefined;
  const lastSeenFrom = url.get("last_seen_from") || undefined;
  const lastSeenTo = url.get("last_seen_to") || undefined;
  const setField = (key: string, value?: string, resetPage = true) => setUrl((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    if (resetPage) next.delete("page");
    return next;
  });
  useEffect(() => { if ((url.get("search") || "") !== searchBox.debounced) setField("search", searchBox.debounced.trim().slice(0, 64)); }, [searchBox.debounced]);
  const params = { environmentId, ownerId, lastSeenFrom, lastSeenTo, search: url.get("search") || undefined, sortBy, sortOrder, page, perPage };
  const query = useQuery({ queryKey: ["device-history-list", params], queryFn: () => deviceHistoryApi.devices(params), placeholderData: keepPreviousData });
  const environments = useQuery({ queryKey: ["history-environments", ownerId], queryFn: () => environmentService.getAll({ page: 1, perPage: 10000, ownerId, sortBy: "name", sortOrder: "asc" }) });
  const owners = useQuery({ queryKey: ["history-owners"], queryFn: () => getUsersAction({ page: 1, size: 10000 }), enabled: isAdmin });
  const environmentOptions = useMemo(() => (environments.data?.items || []).map((item) => ({ value: item.id, label: item.name })), [environments.data]);
  useEffect(() => { if (environmentId && environments.data && !environmentOptions.some((item) => item.value === environmentId)) setField("environment_id"); }, [ownerId, environments.data]);
  useEffect(() => { if (query.data?.total && page > Math.max(1, query.data.pages)) setField("page", String(Math.max(1, query.data.pages)), false); }, [page, query.data?.pages, query.data?.total]);
  const open = (entry: HistoryDevice) => navigate(`/app/devices/history/${encodeURIComponent(entry.serial)}?environmentId=${encodeURIComponent(entry.environmentId)}`);
  const columns: HistoryColumn<HistoryDevice>[] = [
    { id: "serial", title: "Serie", value: (item) => item.serial, sortable: true },
    { id: "device_name", title: "Dispositivo", value: (item) => item.deviceName || "-", sortable: true },
    { id: "environment_name", title: "Establecimiento", value: (item) => item.environmentName || "-", sortable: true },
    ...(isAdmin ? [{ id: "owner_name", title: "Propietario", value: (item: HistoryDevice) => item.ownerName || "-", sortable: true }] : []),
    { id: "first_seen", title: "Primera actividad", value: (item) => formatDateTime(item.firstSeen), sortable: true },
    { id: "last_seen", title: "Última actividad", value: (item) => formatDateTime(item.lastSeen), sortable: true },
    { id: "readings_count", title: "Lecturas", value: (item) => item.readingsCount, sortable: true },
    { id: "operations_count", title: "Operaciones", value: (item) => item.operationsCount, sortable: true },
    { id: "open", title: "Historial", value: (item) => <button className="text-primary underline" onClick={() => open(item)}>Ver historial</button> },
  ];
  const exportRows = async (format: "excel" | "pdf") => {
    const all = await fetchAllPages((nextPage, nextSize) => deviceHistoryApi.devices({ ...params, page: nextPage, perPage: nextSize }));
    const reportColumns = columns.filter((column) => column.id !== "open");
    await downloadReport(format, { title: "Historial de dispositivos", filename: "historial-dispositivos", generatedBy: getExportGeneratedBy(user), columns: reportColumns.map((column) => column.title), data: all.map((item) => reportColumns.map((column) => String(column.value(item)))) });
  };
  return <PageHeader title="Historial de dispositivos" subtitle="Actividad registrada por establecimiento">
    <ListToolbarLayout search={<ListSearchInput value={searchBox.value} onChange={searchBox.setValue} onClear={searchBox.clear} />} primaryActions={<ListFiltersTrigger open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={!!(ownerId || environmentId || lastSeenFrom || lastSeenTo)} />} />
    <ListFiltersPanel open={filtersPanel.open} onOpenChange={filtersPanel.setOpen} hasActiveFilters={!!(ownerId || environmentId || lastSeenFrom || lastSeenTo)} onReset={() => { searchBox.clear(); setUrl(new URLSearchParams()); }}>
      {isAdmin && <ListSelectFilter label="Propietario" value={ownerId} onChange={(value) => { setUrl((previous) => { const next = new URLSearchParams(previous); next.delete("environment_id"); next.delete("page"); if (value) next.set("owner_id", value); else next.delete("owner_id"); return next; }); }} options={(owners.data?.items || []).map((owner) => ({ value: owner.id, label: `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || owner.username }))} />}
      <ListSelectFilter label="Establecimiento" value={environmentId} onChange={(value) => setField("environment_id", value)} options={environmentOptions} />
      <div><Label htmlFor="history-from">Última actividad desde</Label><Input id="history-from" type="date" value={lastSeenFrom || ""} onChange={(event) => setField("last_seen_from", event.target.value)} /></div>
      <div><Label htmlFor="history-to">Última actividad hasta</Label><Input id="history-to" type="date" value={lastSeenTo || ""} onChange={(event) => setField("last_seen_to", event.target.value)} /></div>
    </ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isError ? <ListErrorState message="No se pudo cargar el historial de dispositivos." onRetry={() => query.refetch()} /> : <HistoryResultsTable items={query.data?.items || []} columns={columns} sort={{ sortBy, sortOrder }} onSort={(next) => { setUrl((previous) => { const value = new URLSearchParams(previous); value.set("sort_by", next.sortBy); value.set("sort_order", next.sortOrder); value.delete("page"); return value; }); }} pagination={{ pageIndex: page - 1, pageSize: perPage }} onPagination={(next) => { setUrl((previous) => { const value = new URLSearchParams(previous); value.set("page", String(next.pageIndex + 1)); value.set("size", String(next.pageSize)); return value; }); }} total={query.data?.total || 0} entityName="dispositivos" mobile={<div className="grid gap-3 md:hidden">{(query.data?.items || []).map((item) => <Card key={`${item.serial}:${item.environmentId}`} role="article"><CardHeader><CardTitle>{item.deviceName || item.serial}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>Serie: {item.serial}</p><p>Establecimiento: {item.environmentName || "-"}</p><p>Última actividad: {formatDateTime(item.lastSeen)}</p><button className="text-primary underline" onClick={() => open(item)}>Ver historial</button></CardContent></Card>)}</div>} />}
  </PageHeader>;
}
