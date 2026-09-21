/* eslint-disable react-hooks/incompatible-library */
import { usePermissions } from "@/admin/hooks/usePermissions";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { Filter, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PermissionRow {
  value: string;
  label: string;
  group: string;
  is_basic: boolean;
}

function PermissionMobileCard({
  permission,
  titleId,
}: {
  permission: PermissionRow;
  titleId: string;
}) {
  return (
    <article aria-labelledby={titleId}>
      <Card>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4">
            <div className="min-w-0">
              <span className="text-muted-foreground text-xs font-medium">Permiso:</span>
              <h3 id={titleId} className="break-words font-semibold">
                {permission.label}
              </h3>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground text-xs font-medium">Tipo:</span>
              <div className="mt-1">
                <Badge variant={permission.is_basic ? "default" : "secondary"}>
                  {permission.is_basic ? "Básico" : "Opcional"}
                </Badge>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <div className="min-w-0">
              <span className="text-muted-foreground text-xs font-medium">Código:</span>
              <code className="block break-all text-xs">{permission.value}</code>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground text-xs font-medium">Grupo:</span>
              <div className="mt-1">
                <Badge variant="outline" className="h-auto max-w-full whitespace-normal break-words">
                  {permission.group}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </article>
  );
}

export function PermissionsTable() {
  const { data: permissionsData, isLoading, isError } = usePermissions();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [accordionValue, setAccordionValue] = useState<string>("");

  const data = useMemo<PermissionRow[]>(() => {
    if (!permissionsData || !permissionsData.groups) return [];

    // Flatten the structure
    return permissionsData.groups.flatMap((group) =>
      group.items.map((item) => ({
        value: item.value,
        label: item.label,
        group: group.label,
        is_basic:
          item.is_basic ||
          permissionsData.basic_permissions?.includes(item.value),
      }))
    );
  }, [permissionsData]);

  const columns: ColumnDef<PermissionRow>[] = [
    {
      accessorKey: "label",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Permiso"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="font-medium text-center">{row.getValue("label")}</div>
      ),
    },
    {
      accessorKey: "value",
      header: ({ column }) => (
        <div className="text-center">
          <DataTableColumnHeader
            column={column}
            title="Código"
            className="justify-center"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="font-mono text-xs text-center">
          {row.getValue("value")}
        </div>
      ),
    },
    {
      accessorKey: "group",
      header: ({ column }) => (
        <div className="text-center">
          <DataTableColumnHeader
            column={column}
            title="Grupo"
            className="justify-center"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-center">
          <Badge variant="outline">{row.getValue("group")}</Badge>
        </div>
      ),
      filterFn: (row, id, value) => {
        return value === "all" ? true : value === row.getValue(id);
      },
    },
    {
      accessorKey: "is_basic",
      header: ({ column }) => (
        <div className="text-center">
          <DataTableColumnHeader
            column={column}
            title="Tipo"
            className="justify-center"
          />
        </div>
      ),
      cell: ({ row }) => {
        const isBasic = row.getValue("is_basic");
        return (
          <div className="text-center">
            <Badge variant={isBasic ? "default" : "secondary"}>
              {isBasic ? "Básico" : "Opcional"}
            </Badge>
          </div>
        );
      },
      filterFn: (row, id, value) => {
        const isBasic = row.getValue(id);
        if (value === "basic") return isBasic === true;
        if (value === "optional") return isBasic === false;
        return true;
      },
    },
  ];

  // Unique groups for filter
  const groups = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.map((item) => item.group))).sort();
  }, [data]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  if (isError) return <div>Error al cargar permisos</div>;

  const hasActiveFilters = columnFilters.length > 0;

  const clearAllFilters = () => {
    setColumnFilters([]);
  };

  // Helper to get current filter value
  const getFilterValue = (columnId: string) =>
    (table.getColumn(columnId)?.getFilterValue() as string) || "all";

  // Helper to set filter value
  const setFilterValue = (columnId: string, value: string) => {
    table
      .getColumn(columnId)
      ?.setFilterValue(value === "all" ? undefined : value);
  };

  return (
    <div className="w-full space-y-4">
      <div className="space-y-4">
        <ListToolbarLayout
          search={
            <div className="relative w-full min-w-0">
              <Input
                placeholder="Buscar permisos..."
                value={globalFilter ?? ""}
                onChange={(event) => setGlobalFilter(event.target.value)}
                className="pr-11"
                data-list-toolbar-search-control
              />
              {globalFilter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-1/2 size-11 -translate-y-1/2"
                  onClick={() => setGlobalFilter("")}
                  aria-label="Limpiar búsqueda"
                >
                  <X />
                </Button>
              )}
            </div>
          }
          primaryActions={
            <Button
              variant={
                accordionValue === "advance-filters" ? "secondary" : "default"
              }
              onClick={() =>
                setAccordionValue(
                  accordionValue === "advance-filters" ? "" : "advance-filters"
                )
              }
            >
              <Filter data-icon="inline-start" />
              Filtros
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-2">
                  !
                </Badge>
              )}
            </Button>
          }
          secondaryActions={sorting.length > 0 ? (
            <Button variant="outline" onClick={() => setSorting([])}>
              <RotateCcw data-icon="inline-start" />
              Limpiar ordenamiento
            </Button>
          ) : undefined}
        />

        <Accordion
          type="single"
          collapsible
          value={accordionValue}
          onValueChange={setAccordionValue}
        >
          <AccordionItem value="advance-filters" className="border-none">
            <AccordionContent>
              <div className="rounded-lg border bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Filtros avanzados</h3>
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllFilters}
                    >
                      Limpiar todos
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Grupo</label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={getFilterValue("group")}
                      onChange={(e) => setFilterValue("group", e.target.value)}
                    >
                      <option value="all">Todos</option>
                      {groups.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tipo</label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={getFilterValue("is_basic")}
                      onChange={(e) =>
                        setFilterValue("is_basic", e.target.value)
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="basic">Básico</option>
                      <option value="optional">Opcional</option>
                    </select>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="md:hidden">
        {isLoading ? (
          <div className="rounded-md border p-6 text-center">Cargando...</div>
        ) : rows.length ? (
          <ul aria-label="Permisos" className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <PermissionMobileCard
                  permission={row.original}
                  titleId={`permission-card-title-${row.id}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border p-6 text-center">
            No hay resultados.
          </div>
        )}
      </div>

      <div
        className="hidden rounded-md border md:block"
        data-testid="permissions-desktop-results"
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  Cargando...
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="hover:bg-gray-50/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No hay resultados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4">
        <DataTablePagination
          table={table}
          totalItems={data.length}
          entityName="registros"
        />
      </div>
    </div>
  );
}
