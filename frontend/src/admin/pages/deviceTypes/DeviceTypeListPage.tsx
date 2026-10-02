import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Edit, Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/PageHeader";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import type { DeviceTypeCatalog } from "@/app/types/device.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { CenteredHeader } from "@/components/custom/CenteredHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { useListFilters } from "@/hooks/useListFilters";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { downloadReport } from "@/lib/downloadReport";
import { applySortingUpdate, toSortingState, type ServerSort } from "@/lib/serverSorting";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { showConfirmDialog } from "@/store/confirm.store";
import { deviceTypesApi, type DeviceTypeStatusFilter } from "./deviceTypesApi";

const PATH = "/admin/device-types";
const TITLE = "Tipos de dispositivo";
const sortFields = ["code", "name", "hardware_model", "sensors", "telemetry_interval_s", "offline_after_s", "min_sensors", "is_active"] as const;
type SortField = typeof sortFields[number];
const baseSort: ServerSort<SortField> = { sortBy: "name", sortOrder: "asc" };
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-foreground";

const sensorNames = (item: DeviceTypeCatalog) => item.sensors.map((sensor) => sensor.name).join(", ");
const header = (title: string): ColumnDef<DeviceTypeCatalog>["header"] => ({ column }) => <DataTableColumnHeader column={column} title={title} align="center" />;
const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function DeviceTypeListPage() {
  const user = useAuthStore((state) => state.user);
  const writable = Boolean(user?.isAdmin);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(10000, Math.max(1, Number(params.get("size")) || 10));
  const [sort, setSort] = useState<ServerSort<SortField>>(baseSort);
  const [status, setStatus] = useState<DeviceTypeStatusFilter>("all");
  const [hardwareModel, setHardwareModel] = useState("");
  const [sensorId, setSensorId] = useState("");
  const filters = useListFilters();
  const searchBox = useDebouncedSearch();
  const search = searchBox.debounced.trim();
  const listParams = { page, perPage, search, status, hardwareModel: hardwareModel.trim(), sensorId, sort: `${sort.sortBy}:${sort.sortOrder}` };
  const query = useQuery({ queryKey: ["admin-device-types", listParams], queryFn: () => deviceTypesApi.list(listParams), placeholderData: keepPreviousData });
  const sensorOptions = useQuery({ queryKey: ["sensor-catalog", "sensors"], queryFn: environmentalSensorService.getCatalog });
  const items = query.data?.items ?? [];

  const changePage = (nextPage: number, nextSize = perPage) => setParams({ page: String(nextPage), size: String(nextSize) });
  const hasActiveFilters = status !== "all" || Boolean(hardwareModel || sensorId || search || sort.sortBy !== baseSort.sortBy || sort.sortOrder !== baseSort.sortOrder);
  const clearFilters = () => { setStatus("all"); setHardwareModel(""); setSensorId(""); searchBox.clear(); setSort(baseSort); changePage(1); };
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["admin-device-types"] }),
    queryClient.invalidateQueries({ queryKey: ["devices", "types"] }),
  ]);
  const deactivate = (item: DeviceTypeCatalog) => showConfirmDialog(`¿Desactivar ${item.name}?`, async () => {
    try { await deviceTypesApi.deactivate(item.id); await refresh(); toast.success("Tipo de dispositivo desactivado"); }
    catch { toast.error("No se pudo desactivar el tipo de dispositivo"); }
  });
  const activate = (item: DeviceTypeCatalog) => showConfirmDialog(`¿Activar ${item.name}?`, async () => {
    try { await deviceTypesApi.update(item.id, { isActive: true }); await refresh(); toast.success("Tipo de dispositivo activado"); }
    catch { toast.error("No se pudo activar el tipo de dispositivo"); }
  });


  const columns = useMemo<ColumnDef<DeviceTypeCatalog>[]>(() => [
    { id: "code", accessorFn: (item) => item.code ?? "", header: header("Código"), cell: ({ row }) => <div className="text-center">{row.original.code}</div> },
    { id: "name", accessorKey: "name", header: header("Nombre"), cell: ({ row }) => <div className="text-center">{row.original.name}</div> },
    { id: "hardware_model", accessorFn: (item) => item.hardwareModel ?? "", header: header("Modelo de placa"), cell: ({ row }) => <div className="text-center">{row.original.hardwareModel ?? "—"}</div> },
    { id: "sensors", accessorFn: (item) => item.sensors.length, header: header("Sensores compatibles"), cell: ({ row }) => <div className="text-center">{sensorNames(row.original) || "—"}</div> },
    { id: "telemetry_interval_s", accessorFn: (item) => item.telemetryIntervalS ?? "", header: header("Intervalo (s)"), cell: ({ row }) => <div className="text-center">{row.original.telemetryIntervalS ?? "—"}</div> },
    { id: "offline_after_s", accessorFn: (item) => item.offlineAfterS ?? "", header: header("Sin conexión (s)"), cell: ({ row }) => <div className="text-center">{row.original.offlineAfterS ?? "—"}</div> },
    { id: "min_sensors", accessorKey: "minSensors", header: header("Mín. sensores"), cell: ({ row }) => <div className="text-center">{row.original.minSensors}</div> },
    { id: "is_active", accessorKey: "isActive", header: header("Estado"), cell: ({ row }) => <div className="flex justify-center"><Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Activo" : "Inactivo"}</Badge></div> },
    {
      id: "actions",
      header: () => <CenteredHeader>Acciones</CenteredHeader>,
      cell: ({ row }) => <div className="flex justify-center gap-2">{writable && <>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" asChild><Link to={`${PATH}/edit/${row.original.id}`} aria-label="Editar tipo de dispositivo"><Edit className="size-4" /></Link></Button></TooltipTrigger><TooltipContent>Editar</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={`${row.original.isActive ? "Desactivar" : "Activar"} tipo de dispositivo`} onClick={() => (row.original.isActive ? deactivate(row.original) : activate(row.original))}>{row.original.isActive ? <Trash2 className="size-4" /> : <RotateCw className="size-4" />}</Button></TooltipTrigger><TooltipContent>{row.original.isActive ? "Desactivar" : "Activar"}</TooltipContent></Tooltip>
      </>}</div>,
    },
  ], [writable]);

  const table = useReactTable({
    data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    pageCount: query.data?.pages ?? 0,
    state: { pagination: { pageIndex: page - 1, pageSize: perPage }, sorting: toSortingState(sort) },
    onPaginationChange: (update) => { const next = typeof update === "function" ? update({ pageIndex: page - 1, pageSize: perPage }) : update; changePage(next.pageIndex + 1, next.pageSize); },
    onSortingChange: (update) => { setSort(applySortingUpdate(update, sort, sortFields, baseSort)); changePage(1); },
  });

  const exportRows = async (format: "excel" | "pdf") => {
    const rows = await fetchAllPages((exportPage, exportSize) => deviceTypesApi.list({ ...listParams, page: exportPage, perPage: exportSize }));
    await downloadReport(format, {
      title: `Reporte de ${TITLE}`,
      filename: "tipos-de-dispositivo",
      generatedBy: getExportGeneratedBy(user),
      columns: ["Código", "Nombre", "Modelo de placa", "Sensores compatibles", "Intervalo (s)", "Sin conexión (s)", "Mín. sensores", "Estado"],
      data: rows.map((item) => [text(item.code), item.name, text(item.hardwareModel), sensorNames(item), text(item.telemetryIntervalS), text(item.offlineAfterS), text(item.minSensors), item.isActive ? "Activo" : "Inactivo"]),
    });
  };

  return <div className="space-y-4">
    <PageHeader title={TITLE} subtitle="Plantillas de dispositivo: sensores compatibles, kit por defecto y parámetros" />
    <ListToolbarLayout
      search={<ListSearchInput value={searchBox.value} onChange={(value) => { searchBox.setValue(value.slice(0, 64)); changePage(1); }} onClear={() => { searchBox.clear(); changePage(1); }} />}
      primaryActions={<><ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} />{writable && <Button asChild className="h-11"><Link to={`${PATH}/create`}><Plus data-icon="inline-start" />Nuevo tipo de dispositivo</Link></Button>}</>}
    />
    <ListFiltersPanel open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} onReset={clearFilters} className="lg:grid-cols-3">
      <label className="space-y-1 text-sm">Estado
        <select aria-label="Estado" className={selectClass} value={status} onChange={(event) => { setStatus(event.target.value as DeviceTypeStatusFilter); changePage(1); }}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>
      </label>
      <label className="space-y-1 text-sm">Modelo de placa
        <input aria-label="Modelo de placa" className={selectClass} value={hardwareModel} onChange={(event) => { setHardwareModel(event.target.value); changePage(1); }} />
      </label>
      <label className="space-y-1 text-sm">Sensor compatible
        <select aria-label="Sensor compatible" className={selectClass} value={sensorId} onChange={(event) => { setSensorId(event.target.value); changePage(1); }}><option value="">Todos</option>{sensorOptions.data?.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.name}</option>)}</select>
      </label>
    </ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isError ? <ListErrorState message="No se pudo cargar los tipos de dispositivo." onRetry={() => query.refetch()} /> : <>
      <div className="overflow-x-auto rounded-md border bg-card"><Table>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{query.isPending ? <TableRow><TableCell colSpan={columns.length}>Cargando...</TableCell></TableRow> : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length}>No hay registros.</TableCell></TableRow>}</TableBody>
      </Table></div>
      <DataTablePagination table={table} totalItems={query.data?.total} />
    </>}
  </div>;
}
