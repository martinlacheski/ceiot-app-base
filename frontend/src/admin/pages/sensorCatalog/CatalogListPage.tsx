import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/PageHeader";
import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
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
const sortFields = ["code", "name", "is_active"] as const;
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
  const filters = useListFilters();
  const searchBox = useDebouncedSearch();
  const search = searchBox.debounced.trim();
  const isActive = status === "all" ? undefined : status === "active";
  const listParams = { page, perPage, search, isActive, sort: `${sort.sortBy}:${sort.sortOrder}` };
  const query = useQuery({ queryKey: ["admin-catalog", kind, listParams], queryFn: () => catalogApi.list(kind, listParams), placeholderData: keepPreviousData });
  const items = (query.data?.items ?? []) as Item[];

  const changePage = (nextPage: number, nextSize = perPage) => {
    setParams({ page: String(nextPage), size: String(nextSize) });
  };
  const changeFilter = (next: string) => { setStatus(next); changePage(1); };
  const deactivate = (item: Item) => showConfirmDialog(`¿Desactivar ${item.name}?`, async () => {
    try { await catalogApi.deactivate(kind, item.id); await queryClient.invalidateQueries({ queryKey: ["admin-catalog", kind] }); toast.success(`${sensors ? "Sensor" : "Variable"} desactivado`); }
    catch { toast.error("No se pudo desactivar el registro"); }
  });
  const activate = (item: Item) => showConfirmDialog(`¿Activar ${item.name}?`, async () => {
    try { await catalogApi.update(kind, item.id, { isActive: true }); await queryClient.invalidateQueries({ queryKey: ["admin-catalog", kind] }); toast.success(`${sensors ? "Sensor" : "Variable"} activado`); }
    catch { toast.error("No se pudo activar el registro"); }
  });
  const columns = useMemo<ColumnDef<Item>[]>(() => [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Código" /> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" /> },
    sensors ? { id: "manufacturer", accessorFn: (item) => "manufacturer" in item ? item.manufacturer : "", header: "Fabricante" } : { id: "unit", accessorFn: (item) => "unit" in item ? item.unit : "", header: "Unidad" },
    ...(sensors ? [{ id: "variables", header: "Variables", cell: ({ row }: { row: { original: Item } }) => "variables" in row.original ? row.original.variables.map((v) => v.name).join(", ") : "" } as ColumnDef<Item>] : []),
    { accessorKey: "isActive", id: "is_active", header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />, cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Activo" : "Inactivo"}</Badge> },
    { id: "actions", header: () => <CenteredHeader>Acciones</CenteredHeader>, cell: ({ row }) => <div className="flex justify-center gap-2">{writable && <><Button variant="outline" size="sm" asChild><Link to={`${path}/edit/${row.original.id}`}>Editar</Link></Button><Button variant="outline" size="sm" onClick={() => row.original.isActive ? deactivate(row.original) : activate(row.original)}>{row.original.isActive ? "Desactivar" : "Activar"}</Button></>}</div> },
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
    <ListToolbarLayout search={<ListSearchInput value={searchBox.value} onChange={(value) => { searchBox.setValue(value); changePage(1); }} onClear={() => { searchBox.clear(); changePage(1); }} />} primaryActions={<><ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={status !== "all"} />{writable && <Button asChild><Link to={`${path}/create`}><Plus data-icon="inline-start" />Nuevo</Link></Button>}</>} />
    <ListFiltersPanel open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={status !== "all"} onReset={() => { changeFilter("all"); searchBox.clear(); setSort(baseSort); }}><label className="space-y-1 text-sm">Estado<select aria-label="Estado" className="h-10 w-full rounded-md border border-input bg-background px-3" value={status} onChange={(event) => changeFilter(event.target.value)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label></ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isError ? <ListErrorState message={`No se pudo cargar ${title.toLowerCase()}.`} onRetry={() => query.refetch()} /> : <><div className="overflow-x-auto rounded-md border bg-card"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{query.isPending ? <TableRow><TableCell colSpan={columns.length}>Cargando...</TableCell></TableRow> : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length}>No hay registros.</TableCell></TableRow>}</TableBody></Table></div><DataTablePagination table={table} totalItems={query.data?.total} /></>}
  </div>;
}
