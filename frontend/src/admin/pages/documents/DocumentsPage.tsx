import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Download, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { CenteredHeader } from "@/components/custom/CenteredHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListFiltersPanel, ListFiltersTrigger } from "@/components/custom/ListFiltersAccordion";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { useListFilters } from "@/hooks/useListFilters";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { applySortingUpdate, toSortingState, type ServerSort } from "@/lib/serverSorting";
import { formatDateTime } from "@/utils/date.utils";
import { showConfirmDialog } from "@/store/confirm.store";
import { documentErrorMessage, documentsApi, type DocumentItem } from "./documentsApi";
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPE_LABELS,
  INGESTION_STATUSES,
  INGESTION_STATUS_LABELS,
  INGESTION_STATUS_VARIANTS,
  embeddingLabel,
  formatBytes,
  pollInterval,
  statusOf,
  typeLabelOf,
} from "./documentUtils";
import { UploadDocumentDialog } from "./UploadDocumentDialog";
import { RenameDocumentDialog } from "./RenameDocumentDialog";

const sortFields = ["title", "contentType", "sizeBytes", "ingestionStatus", "createdAt"] as const;
type SortField = (typeof sortFields)[number];
const baseSort: ServerSort<SortField> = { sortBy: "createdAt", sortOrder: "desc" };
const QUERY_KEY = "admin-documents";
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-foreground";

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.get("size")) || 10));
  const [sort, setSort] = useState<ServerSort<SortField>>(baseSort);
  const [fileType, setFileType] = useState("");
  const [ingestionStatus, setIngestionStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renaming, setRenaming] = useState<DocumentItem | null>(null);
  const filters = useListFilters();
  const searchBox = useDebouncedSearch();
  const search = searchBox.debounced.trim();

  const listParams = { page, perPage, search, fileType, ingestionStatus, sort: `${sort.sortBy}:${sort.sortOrder}` };
  const query = useQuery({ queryKey: [QUERY_KEY, listParams], queryFn: () => documentsApi.list(listParams), placeholderData: keepPreviousData,
    // Live status: keep refreshing while any document is being indexed.
    refetchInterval: (current) => pollInterval(current.state.data?.items) });
  const items = query.data?.items ?? [];

  const changePage = (nextPage: number, nextSize = perPage) => setParams({ page: String(nextPage), size: String(nextSize) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
  const hasActiveFilters = Boolean(fileType || ingestionStatus || search || sort.sortBy !== baseSort.sortBy || sort.sortOrder !== baseSort.sortOrder);
  const clearFilters = () => { setFileType(""); setIngestionStatus(""); searchBox.clear(); setSort(baseSort); changePage(1); };

  const download = async (item: DocumentItem) => {
    try { await documentsApi.download(item); }
    catch (error) { toast.error(documentErrorMessage(error, "No se pudo descargar el documento")); }
  };
  const remove = (item: DocumentItem) => showConfirmDialog(
    `¿Eliminar "${item.title}"? Se borra también el archivo y no se puede deshacer.`,
    async () => {
      try { await documentsApi.remove(item.id); await refresh(); toast.success("Documento eliminado"); }
      catch (error) { toast.error(documentErrorMessage(error, "No se pudo eliminar el documento")); }
    },
  );
  const reindex = async (item: DocumentItem) => {
    try { await documentsApi.ingest(item.id); await refresh(); toast.success("Indexación en curso"); }
    catch (error) { toast.error(documentErrorMessage(error, "No se pudo iniciar la indexación")); }
  };
  const reindexStale = async () => {
    try {
      const { queued } = await documentsApi.reindex();
      await refresh();
      toast.success(queued ? `Se reindexan ${queued} documento${queued === 1 ? "" : "s"}` : "No hay documentos para reindexar");
    } catch (error) { toast.error(documentErrorMessage(error, "No se pudo iniciar la reindexación")); }
  };
  const rename = async (item: DocumentItem, title: string) => {
    try { await documentsApi.rename(item.id, title); await refresh(); setRenaming(null); toast.success("Documento renombrado"); }
    catch (error) { toast.error(documentErrorMessage(error, "No se pudo renombrar el documento")); }
  };

  const columns = useMemo<ColumnDef<DocumentItem>[]>(() => {
    const iconAction = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11" aria-label={label} onClick={onClick} disabled={disabled}>{icon}</Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
    return [
      { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Título" align="center" />,
        cell: ({ row }) => <div className="text-center"><div className="font-medium">{row.original.title}</div><div className="text-xs text-muted-foreground">{row.original.filename}</div></div> },
      { accessorKey: "contentType", header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" align="center" />,
        cell: ({ row }) => <div className="text-center">{typeLabelOf(row.original.filename)}</div> },
      { accessorKey: "sizeBytes", header: ({ column }) => <DataTableColumnHeader column={column} title="Tamaño" align="center" />,
        cell: ({ row }) => <div className="text-center">{formatBytes(row.original.sizeBytes)}</div> },
      { accessorKey: "ingestionStatus", header: ({ column }) => <DataTableColumnHeader column={column} title="Ingesta" align="center" />,
        cell: ({ row }) => { const item = row.original; const state = statusOf(item.ingestionStatus);
          const label = embeddingLabel(item.embeddingProvider, item.embeddingModel);
          return <div className="flex flex-col items-center gap-1">
            <Badge variant={INGESTION_STATUS_VARIANTS[state]}>{INGESTION_STATUS_LABELS[state]}</Badge>
            {state === "ready" && <div className="text-xs text-muted-foreground"><div>{item.chunkCount} fragmentos</div>{label && <div>{label}</div>}</div>}
            {item.needsReindex && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Requiere reindexar</Badge>}
            {state === "failed" && item.error && <div className="max-w-60 text-xs text-destructive">{item.error}</div>}
          </div>; } },
      { accessorKey: "createdAt", header: ({ column }) => <DataTableColumnHeader column={column} title="Subido" align="center" />,
        cell: ({ row }) => <div className="text-center">{formatDateTime(row.original.createdAt)}</div> },
      { id: "actions", header: () => <CenteredHeader>Acciones</CenteredHeader>,
        cell: ({ row }) => <div className="flex justify-center gap-1">
          {iconAction("Reindexar", <RefreshCw className="size-4" />, () => reindex(row.original), row.original.ingestionStatus === "processing")}
          {iconAction("Descargar", <Download className="size-4" />, () => download(row.original))}
          {iconAction("Renombrar", <Pencil className="size-4" />, () => setRenaming(row.original))}
          {iconAction("Eliminar", <Trash2 className="size-4" />, () => remove(row.original))}
        </div> },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table = useReactTable({
    data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    pageCount: query.data?.pages ?? 0,
    state: { pagination: { pageIndex: page - 1, pageSize: perPage }, sorting: toSortingState(sort) },
    onPaginationChange: (update) => {
      const next = typeof update === "function" ? update({ pageIndex: page - 1, pageSize: perPage }) : update;
      changePage(next.pageIndex + 1, next.pageSize);
    },
    onSortingChange: (update) => { setSort(applySortingUpdate(update, sort, sortFields, baseSort)); changePage(1); },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Documentos" subtitle="Archivos que alimentan el asistente (base de conocimiento)" />
      <ListToolbarLayout
        search={<ListSearchInput value={searchBox.value} onChange={(value) => { searchBox.setValue(value.slice(0, 64)); changePage(1); }} onClear={() => { searchBox.clear(); changePage(1); }} />}
        primaryActions={<>
          <ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} />
          <Button variant="outline" className="h-11" onClick={reindexStale}><RefreshCw data-icon="inline-start" />Reindexar desactualizados</Button>
          <Button className="h-11" onClick={() => setUploadOpen(true)}><Upload data-icon="inline-start" />Subir documento</Button>
        </>}
      />
      <ListFiltersPanel open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={hasActiveFilters} onReset={clearFilters}>
        <label className="space-y-1 text-sm">Tipo
          <select aria-label="Tipo" className={selectClass} value={fileType} onChange={(event) => { setFileType(event.target.value); changePage(1); }}>
            <option value="">Todos</option>
            {DOCUMENT_EXTENSIONS.map((ext) => <option key={ext} value={ext}>{DOCUMENT_TYPE_LABELS[ext]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Estado de ingesta
          <select aria-label="Estado de ingesta" className={selectClass} value={ingestionStatus} onChange={(event) => { setIngestionStatus(event.target.value); changePage(1); }}>
            <option value="">Todos</option>
            {INGESTION_STATUSES.map((state) => <option key={state} value={state}>{INGESTION_STATUS_LABELS[state]}</option>)}
          </select>
        </label>
      </ListFiltersPanel>
      {query.isError ? <ListErrorState message="No se pudieron cargar los documentos." onRetry={() => query.refetch()} /> : <>
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
            <TableBody>
              {query.isPending ? <TableRow><TableCell colSpan={columns.length}>Cargando...</TableCell></TableRow>
                : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)
                : <TableRow><TableCell colSpan={columns.length}>No hay documentos.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <DataTablePagination table={table} totalItems={query.data?.total} />
      </>}
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refresh} />
      <RenameDocumentDialog document={renaming} onClose={() => setRenaming(null)} onSave={rename} />
    </div>
  );
}
