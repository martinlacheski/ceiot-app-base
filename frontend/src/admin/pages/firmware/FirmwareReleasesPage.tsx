import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/app/components/PageHeader";
import { firmwareKeys, firmwareService, getFirmwareErrorMessage } from "@/app/services/firmware.service";
import type { FirmwarePageParams, FirmwareRelease } from "@/app/types/firmware.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { CenteredHeader } from "@/components/custom/CenteredHeader";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { useListFilters } from "@/hooks/useListFilters";
import { downloadReport } from "@/lib/downloadReport";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { formatFileSize } from "@/lib/fileSize";
import { applySortingUpdate, toSortingState, type ServerSort } from "@/lib/serverSorting";
import { showConfirmDialog } from "@/store/confirm.store";
import { formatDateTime } from "@/utils/date.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";

const PATH = "/admin/firmware";
const TITLE = "Firmware";
// Column ids equal the sort keys the backend accepts (`createdAt`, `version`).
const sortFields = ["version", "createdAt"] as const;
type SortField = typeof sortFields[number];
const baseSort: ServerSort<SortField> = { sortBy: "createdAt", sortOrder: "desc" };
// The backend pages at most 100 releases at a time.
const EXPORT_PAGE_SIZE = 100;
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-foreground";
type StatusFilter = "all" | "active" | "inactive";

const statusLabel = (release: FirmwareRelease) => (release.active ? "Activo" : "Inactivo");
const StatusBadge = ({ release }: { release: FirmwareRelease }) => (
  <Badge variant={release.active ? "default" : "secondary"}>{statusLabel(release)}</Badge>
);
const header = (title: string): ColumnDef<FirmwareRelease>["header"] => ({ column }) => (
  <DataTableColumnHeader column={column} title={title} align="center" />
);
const toggleLabel = (release: FirmwareRelease) => `${release.active ? "Desactivar" : "Activar"} ${release.version}`;

export function FirmwareReleasesPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.get("size")) || 10));
  const [sort, setSort] = useState<ServerSort<SortField>>(baseSort);
  const [status, setStatus] = useState<StatusFilter>("all");
  const filters = useListFilters();
  const searchBox = useDebouncedSearch();
  const search = searchBox.debounced.trim() || undefined;
  const listParams: FirmwarePageParams = {
    page,
    perPage,
    search,
    active: status === "all" ? undefined : status === "active",
    sort: `${sort.sortBy}:${sort.sortOrder}`,
  };
  const query = useQuery({
    queryKey: [...firmwareKeys.releases(), listParams],
    queryFn: () => firmwareService.pageReleases(listParams),
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];

  const changePage = (nextPage: number, nextSize = perPage) => setParams({ page: String(nextPage), size: String(nextSize) });
  const hasActiveFilters = status !== "all" || Boolean(search || sort.sortBy !== baseSort.sortBy || sort.sortOrder !== baseSort.sortOrder);
  const clearFilters = () => { setStatus("all"); searchBox.clear(); setSort(baseSort); changePage(1); };
  const toggle = (release: FirmwareRelease) => {
    const next = !release.active;
    showConfirmDialog(`¿${next ? "Activar" : "Desactivar"} el firmware ${release.version}?`, async () => {
      try {
        await firmwareService.setReleaseActive(release.id, next);
        await queryClient.invalidateQueries({ queryKey: firmwareKeys.all });
        toast.success(next ? "Firmware activado" : "Firmware desactivado");
      } catch (error) {
        toast.error(getFirmwareErrorMessage(error, "No se pudo cambiar el estado del firmware"));
      }
    });
  };

  const columns = useMemo<ColumnDef<FirmwareRelease>[]>(() => [
    { id: "version", accessorKey: "version", header: header("Versión"), cell: ({ row }) => <div className="text-center font-medium">{row.original.version}</div> },
    { id: "size", enableSorting: false, header: () => <CenteredHeader>Tamaño</CenteredHeader>, cell: ({ row }) => <div className="text-center">{formatFileSize(row.original.size)}</div> },
    { id: "notes", enableSorting: false, header: () => <CenteredHeader>Notas</CenteredHeader>, cell: ({ row }) => <div className="text-center">{row.original.notes || "—"}</div> },
    { id: "createdAt", accessorKey: "createdAt", header: header("Subido"), cell: ({ row }) => <div className="text-center">{formatDateTime(row.original.createdAt)}</div> },
    { id: "status", enableSorting: false, header: () => <CenteredHeader>Estado</CenteredHeader>, cell: ({ row }) => <div className="flex justify-center"><StatusBadge release={row.original} /></div> },
    {
      id: "actions",
      enableSorting: false,
      header: () => <CenteredHeader>Acciones</CenteredHeader>,
      cell: ({ row }) => <div className="flex justify-center gap-2">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={toggleLabel(row.original)} onClick={() => toggle(row.original)}>{row.original.active ? <Trash2 className="size-4" /> : <RotateCw className="size-4" />}</Button></TooltipTrigger><TooltipContent>{row.original.active ? "Desactivar" : "Activar"}</TooltipContent></Tooltip>
      </div>,
    },
  ], []);

  const table = useReactTable({
    data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    pageCount: query.data?.pages ?? 0,
    state: { pagination: { pageIndex: page - 1, pageSize: perPage }, sorting: toSortingState(sort) },
    onPaginationChange: (update) => { const next = typeof update === "function" ? update({ pageIndex: page - 1, pageSize: perPage }) : update; changePage(next.pageIndex + 1, next.pageSize); },
    onSortingChange: (update) => { setSort(applySortingUpdate(update, sort, sortFields, baseSort)); changePage(1); },
  });
  const rows = table.getRowModel().rows;

  const exportRows = async (format: "excel" | "pdf") => {
    const all = await fetchAllPages((exportPage, exportSize) => firmwareService.pageReleases({ ...listParams, page: exportPage, perPage: exportSize }), { perPage: EXPORT_PAGE_SIZE });
    await downloadReport(format, {
      title: `Reporte de ${TITLE}`,
      filename: "firmware",
      generatedBy: getExportGeneratedBy(user),
      columns: ["Versión", "Tamaño", "Notas", "Subido", "Estado"],
      data: all.map((release) => [release.version, formatFileSize(release.size), release.notes ?? "", formatDateTime(release.createdAt), statusLabel(release)]),
    });
  };

  return <div className="space-y-4">
    <PageHeader title={TITLE} subtitle="Imágenes de firmware para actualizar los dispositivos (OTA)" />
    <ListToolbarLayout
      search={<ListSearchInput value={searchBox.value} onChange={(value) => { searchBox.setValue(value.slice(0, 64)); changePage(1); }} onClear={() => { searchBox.clear(); changePage(1); }} />}
      primaryActions={<><ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} /><Button asChild className="h-11"><Link to={`${PATH}/create`}><Plus data-icon="inline-start" />Nuevo firmware</Link></Button></>}
    />
    <ListFiltersPanel open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} onReset={clearFilters}>
      <label className="space-y-1 text-sm">Estado
        <select aria-label="Estado" className={selectClass} value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); changePage(1); }}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>
      </label>
    </ListFiltersPanel>
    <ListExportActions onExport={exportRows} disabled={!query.data?.total} />
    {query.isError ? <ListErrorState message="No se pudo cargar la lista de firmware." onRetry={() => query.refetch()} /> : <>
      <div className="flex flex-col gap-3 lg:hidden" data-testid="firmware-cards">
        {query.isPending ? <p className="py-8 text-center text-sm text-muted-foreground">Cargando...</p> : rows.length ? rows.map(({ original: release }) => (
          <Card key={release.id} className="min-w-0 gap-4 overflow-hidden py-4">
            <CardHeader className="min-w-0 px-4">
              <CardTitle className="min-w-0 truncate pr-2">{release.version}</CardTitle>
              <CardAction><StatusBadge release={release} /></CardAction>
            </CardHeader>
            <div className="flex flex-col gap-1 px-4 text-sm text-muted-foreground">
              <span>{formatFileSize(release.size)} · {formatDateTime(release.createdAt)}</span>
              {release.notes && <span className="break-words">{release.notes}</span>}
            </div>
            <CardFooter className="px-4">
              <Button variant="outline" className="min-h-11 flex-1" aria-label={toggleLabel(release)} onClick={() => toggle(release)}>
                {release.active ? <Trash2 data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
                {release.active ? "Desactivar" : "Activar"}
              </Button>
            </CardFooter>
          </Card>
        )) : <p className="py-8 text-center text-sm text-muted-foreground">No hay registros.</p>}
      </div>
      <div className="hidden overflow-x-auto rounded-md border bg-card lg:block" data-testid="firmware-table"><Table>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((head) => <TableHead key={head.id}>{flexRender(head.column.columnDef.header, head.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{query.isPending ? <TableRow><TableCell colSpan={columns.length}>Cargando...</TableCell></TableRow> : rows.length ? rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length}>No hay registros.</TableCell></TableRow>}</TableBody>
      </Table></div>
      <DataTablePagination table={table} totalItems={query.data?.total} entityName="firmwares" entityNameSingular="firmware" />
    </>}
  </div>;
}

export default FirmwareReleasesPage;
