import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Edit, Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/PageHeader";
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
import { catalogApi, type CatalogKind, type Sensor, type Variable } from "./catalogApi";

type Item = Sensor | Variable;
const sortFields = ["code", "name", "manufacturer", "variables", "unit", "is_active"] as const;
type SortField = typeof sortFields[number];
const baseSort: ServerSort<SortField> = { sortBy: "code", sortOrder: "asc" };

export function CatalogListPage({ kind }: { kind: CatalogKind }) {
  const sensors = kind === "sensors";
  const title = sensors ? "Sensores" : "Variables";
  const path = `/admin/${kind}`;
  const user = useAuthStore((state) => state.user);
  const writable = Boolean(user?.isAdmin && user.permissions?.includes("sensor_catalog:write"));
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(10000, Math.max(1, Number(params.get("size")) || 10));
  const [sort, setSort] = useState<ServerSort<SortField>>(baseSort);
  const [status, setStatus] = useState("all");
  const [manufacturer, setManufacturer] = useState("");
  const [variableId, setVariableId] = useState("");
  const [unit, setUnit] = useState("");
  const filters = useListFilters();
  const searchBox = useDebouncedSearch();
  const search = searchBox.debounced.trim();
  const isActive = status === "all" ? undefined : status === "active";
  const listParams = { page, perPage, search, isActive, manufacturer: sensors ? manufacturer.trim() : undefined, variableId: sensors ? variableId : undefined, unit: sensors ? undefined : unit.trim(), sort: `${sort.sortBy}:${sort.sortOrder}` };
  const query = useQuery({ queryKey: ["admin-catalog", kind, listParams], queryFn: () => catalogApi.list(kind, listParams), placeholderData: keepPreviousData });
  const variableOptions = useQuery({ queryKey: ["admin-catalog", "variable-options"], queryFn: () => catalogApi.list("variables", { page: 1, perPage: 10000 }), enabled: sensors });
  const items = (query.data?.items ?? []) as Item[];

  const changePage = (nextPage: number, nextSize = perPage) => {
    setParams({ page: String(nextPage), size: String(nextSize) });
  };
  const changeFilter = (next: string) => { setStatus(next); changePage(1); };
  const hasActiveFilters = status !== "all" || Boolean(manufacturer || variableId || unit || search || sort.sortBy !== "code" || sort.sortOrder !== "asc");
  const clearFilters = () => { setStatus("all"); setManufacturer(""); setVariableId(""); setUnit(""); searchBox.clear(); setSort(baseSort); changePage(1); };
  const deactivate = (item: Item) => showConfirmDialog(`¿Desactivar ${item.name}?`, async () => {
    try { await catalogApi.deactivate(kind, item.id); await queryClient.invalidateQueries({ queryKey: ["admin-catalog", kind] }); toast.success(sensors ? "Sensor desactivado" : "Variable desactivada"); }
    catch { toast.error("No se pudo desactivar el registro"); }
  });
  const activate = (item: Item) => showConfirmDialog(`¿Activar ${item.name}?`, async () => {
    try { await catalogApi.update(kind, item.id, { isActive: true }); await queryClient.invalidateQueries({ queryKey: ["admin-catalog", kind] }); toast.success(sensors ? "Sensor activado" : "Variable activada"); }
    catch { toast.error("No se pudo activar el registro"); }
  });
  const columns = useMemo<ColumnDef<Item>[]>(() => [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Código" align="center" />, cell: ({ row }) => <div className="text-center">{row.original.code}</div> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" align="center" />, cell: ({ row }) => <div className="text-center">{row.original.name}</div> },
    sensors ? { id: "manufacturer", accessorFn: (item) => "manufacturer" in item ? item.manufacturer : "", header: ({ column }) => <DataTableColumnHeader column={column} title="Fabricante" align="center" />, cell: ({ row }) => <div className="text-center">{"manufacturer" in row.original ? row.original.manufacturer : ""}</div> } : { id: "unit", accessorFn: (item) => "unit" in item ? item.unit : "", header: ({ column }) => <DataTableColumnHeader column={column} title="Unidad" align="center" />, cell: ({ row }) => <div className="text-center">{"unit" in row.original ? row.original.unit : ""}</div> },
    ...(sensors ? [{ id: "variables", accessorFn: (item: Item) => "variables" in item ? item.variables.length : 0, header: ({ column }) => <DataTableColumnHeader column={column} title="Variables" align="center" />, cell: ({ row }) => <div className="text-center">{"variables" in row.original ? row.original.variables.map((v) => v.name).join(", ") : ""}</div> } as ColumnDef<Item>] : []),
    { accessorKey: "isActive", id: "is_active", header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" align="center" />, cell: ({ row }) => <div className="flex justify-center"><Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Activo" : "Inactivo"}</Badge></div> },
    { id: "actions", header: () => <CenteredHeader>Acciones</CenteredHeader>, cell: ({ row }) => <div className="flex justify-center gap-2">{writable && <><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" asChild><Link to={`${path}/edit/${row.original.id}`} aria-label={`Editar ${sensors ? "sensor" : "variable"}`}><Edit className="size-4" /></Link></Button></TooltipTrigger><TooltipContent>Editar</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={`${row.original.isActive ? "Desactivar" : "Activar"} ${sensors ? "sensor" : "variable"}`} onClick={() => row.original.isActive ? deactivate(row.original) : activate(row.original)}>{row.original.isActive ? <Trash2 className="size-4" /> : <RotateCw className="size-4" />}</Button></TooltipTrigger><TooltipContent>{row.original.isActive ? "Desactivar" : "Activar"}</TooltipContent></Tooltip></>}</div> },
  ], [sensors, path, writable]);
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    pageCount: query.data?.pages ?? 0, state: { pagination: { pageIndex: page - 1, pageSize: perPage }, sorting: toSortingState(sort) },
    onPaginationChange: (update) => { const next = typeof update === "function" ? update({ pageIndex: page - 1, pageSize: perPage }) : update; changePage(next.pageIndex + 1, next.pageSize); },
    onSortingChange: (update) => { setSort(applySortingUpdate(update, sort, sortFields, baseSort)); changePage(1); },
  });
  const exportRows = async (format: "excel" | "pdf") => {
    const rows = await fetchAllPages((exportPage, exportSize) => catalogApi.list(kind, { ...listParams, page: exportPage, perPage: exportSize }));
    await downloadReport(format, { title: `Reporte de ${title}`, filename: `catalogo-${kind}`, generatedBy: getExportGeneratedBy(user), columns: sensors ? ["Código", "Nombre", "Fabricante", "Variables", "Estado"] : ["Código", "Nombre", "Unidad", "Estado"],
      data: rows.map((item) => sensors && "manufacturer" in item ? [item.code, item.name, item.manufacturer, item.variables.map((v) => v.name).join(", "), item.isActive ? "Activo" : "Inactivo"] : [item.code, item.name, "unit" in item ? item.unit : "", item.isActive ? "Activo" : "Inactivo"]), });
  };
  return <div className="space-y-4">
    <PageHeader title={title} subtitle={`Catálogo de ${title.toLowerCase()}`} />
    <ListToolbarLayout search={<ListSearchInput value={searchBox.value} onChange={(value) => { searchBox.setValue(value.slice(0, 64)); changePage(1); }} onClear={() => { searchBox.clear(); changePage(1); }} />} primaryActions={<><ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} />{writable && <Button asChild className="h-11"><Link to={`${path}/create`}><Plus data-icon="inline-start" />{sensors ? "Nuevo sensor" : "Nueva variable"}</Link></Button>}</>} />
    <ListFiltersPanel open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} onReset={clearFilters} className={sensors ? "lg:grid-cols-3" : undefined}><label className="space-y-1 text-sm">Estado<select aria-label="Estado" className="h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={status} onChange={(event) => changeFilter(event.target.value)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>{sensors ? <><label className="space-y-1 text-sm">Fabricante<input aria-label="Fabricante" className="h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={manufacturer} onChange={(event) => { setManufacturer(event.target.value); changePage(1); }} /></label><label className="space-y-1 text-sm">Mide la variable<select aria-label="Mide la variable" className="h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={variableId} onChange={(event) => { setVariableId(event.target.value); changePage(1); }}><option value="">Todas</option>{variableOptions.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></> : <label className="space-y-1 text-sm">Unidad<input aria-label="Unidad" className="h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={unit} onChange={(event) => { setUnit(event.target.value); changePage(1); }} /></label>}</ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isError ? <ListErrorState message={`No se pudo cargar ${title.toLowerCase()}.`} onRetry={() => query.refetch()} /> : <><div className="overflow-x-auto rounded-md border bg-card"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{query.isPending ? <TableRow><TableCell colSpan={columns.length}>Cargando...</TableCell></TableRow> : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length}>No hay registros.</TableCell></TableRow>}</TableBody></Table></div><DataTablePagination table={table} totalItems={query.data?.total} /></>}
  </div>;
}
