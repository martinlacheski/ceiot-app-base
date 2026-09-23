/* eslint-disable react-hooks/incompatible-library */
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type PaginationState, type SortingState, type Updater } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applySortingUpdate, toSortingState, type ServerSort } from "@/lib/serverSorting";

export interface HistoryColumn<T> { id: string; title: string; value: (item: T) => React.ReactNode; sortable?: boolean }

export function HistoryResultsTable<T extends object>({ items, columns, sort, onSort, pagination, onPagination, total, mobile, entityName = "registros" }: {
  items: T[]; columns: HistoryColumn<T>[]; sort: ServerSort<string>; onSort: (sort: ServerSort<string>) => void;
  pagination: PaginationState; onPagination: (next: PaginationState) => void; total: number; mobile: React.ReactNode; entityName?: string;
}) {
  const defs: ColumnDef<T>[] = columns.map((item) => ({
    id: item.id, accessorFn: (row) => row[item.id as keyof T],
    enableSorting: item.sortable ?? false,
    header: ({ column }) => <DataTableColumnHeader column={column} title={item.title} align="center" />,
    cell: ({ row }) => item.value(row.original),
  }));
  const allowed = columns.filter((item) => item.sortable).map((item) => item.id);
  const table = useReactTable({
    data: items, columns: defs, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)), autoResetPageIndex: false,
    state: { pagination, sorting: toSortingState(sort) },
    onPaginationChange: (updater: Updater<PaginationState>) => onPagination(typeof updater === "function" ? updater(pagination) : updater),
    onSortingChange: (updater: Updater<SortingState>) => onSort(applySortingUpdate(updater, sort, allowed, sort)),
  });
  return <>
    <div className="hidden overflow-x-auto rounded-md border md:block"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} className="text-center">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground">Sin resultados</TableCell></TableRow>}</TableBody></Table></div>
    {mobile}
    <DataTablePagination table={table} totalItems={total} entityName={entityName} />
  </>;
}
