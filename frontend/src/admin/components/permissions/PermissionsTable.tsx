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
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { Filter, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useAuthStore } from "@/auth/store/auth.store";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import {
  ListExportActions,
  type ListExportFormat,
} from "@/components/custom/ListExportActions";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";

interface PermissionRow {
  value: string;
  label: string;
  group: string;
  is_basic: boolean;
}

const SORTABLE_COLUMNS = new Set(["label", "value", "group", "is_basic"]);

function parseSorting(raw: string | null): SortingState {
  if (!raw) return [];

  const sorting = raw.split(",").map((entry) => {
    const [id, direction, ...extra] = entry.split(":");
    if (
      extra.length > 0 ||
      !SORTABLE_COLUMNS.has(id) ||
      (direction !== "asc" && direction !== "desc")
    ) {
      return null;
    }
    return { id, desc: direction === "desc" };
  });

  return sorting.every((entry) => entry !== null)
    ? (sorting as SortingState)
    : [];
}

function serializeSorting(sorting: SortingState): string | null {
  return sorting.length
    ? sorting.map(({ id, desc }) => `${id}:${desc ? "desc" : "asc"}`).join(",")
    : null;
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
  const {
    data: permissionsData,
    isLoading,
    isError,
    refetch,
  } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();

  const [accordionValue, setAccordionValue] = useState<string>("");

  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const globalFilter = searchParams.get("search") ?? "";
  const groupFilter = searchParams.get("group");
  const typeParam = searchParams.get("type");
  const typeFilter = typeParam === "basic" || typeParam === "optional" ? typeParam : null;
  const sorting = useMemo(
    () => parseSorting(searchParams.get("sort")),
    [searchParams],
  );
  const columnFilters = useMemo<ColumnFiltersState>(
    () => [
      ...(groupFilter ? [{ id: "group", value: groupFilter }] : []),
      ...(typeFilter ? [{ id: "is_basic", value: typeFilter }] : []),
    ],
    [groupFilter, typeFilter],
  );
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page - 1, pageSize: size }),
    [page, size],
  );

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
      id: "is_basic",
      accessorFn: (row) => (row.is_basic ? "Básico" : "Opcional"),
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
        const isBasic = row.original.is_basic;
        return (
          <div className="text-center">
            <Badge variant={isBasic ? "default" : "secondary"}>
              {isBasic ? "Básico" : "Opcional"}
            </Badge>
          </div>
        );
      },
      filterFn: (row, _id, value) => {
        const isBasic = row.original.is_basic;
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

  const updateUrl = (
    updates: Record<string, string | null>,
    { resetPage = false, replace = false } = {},
  ) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete("page");
    setSearchParams(next, { replace });
  };

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const rawPage = searchParams.get("page");
    const rawSize = searchParams.get("size");

    if (rawPage !== null && (!/^\d+$/.test(rawPage) || Number(rawPage) < 1)) {
      next.delete("page");
      changed = true;
    }
    if (rawSize !== null && (!/^\d+$/.test(rawSize) || Number(rawSize) < 1)) {
      next.delete("size");
      changed = true;
    }
    if (typeParam !== null && !typeFilter) {
      next.delete("type");
      changed = true;
    }
    if (searchParams.has("sort") && parseSorting(searchParams.get("sort")).length === 0) {
      next.delete("sort");
      changed = true;
    }
    if (permissionsData && groupFilter && !groups.includes(groupFilter)) {
      next.delete("group");
      changed = true;
    }

    if (changed) setSearchParams(next, { replace: true });
  }, [
    groupFilter,
    groups,
    permissionsData,
    searchParams,
    setSearchParams,
    typeFilter,
    typeParam,
  ]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination,
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      updateUrl({ sort: serializeSorting(next) }, { resetPage: true });
    },
    onColumnFiltersChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnFilters) : updater;
      updateUrl(
        {
          group: (next.find(({ id }) => id === "group")?.value as string) ?? null,
          type: (next.find(({ id }) => id === "is_basic")?.value as string) ?? null,
        },
        { resetPage: true },
      );
    },
    onGlobalFilterChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(globalFilter) : updater;
      updateUrl({ search: next || null }, { resetPage: true });
    },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      updateUrl({
        page: String(next.pageIndex + 1),
        size: String(next.pageSize),
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    autoResetPageIndex: false,
  });

  const rows = table.getRowModel().rows;
  const matchingRows = table.getPrePaginationRowModel().rows;

  useEffect(() => {
    if (matchingRows.length === 0) return;
    const lastPage = Math.max(1, Math.ceil(matchingRows.length / size));
    if (page > lastPage) {
      updateUrl({ page: String(lastPage) }, { replace: true });
    }
  }, [matchingRows.length, page, size]);

  if (isError) {
    return (
      <ListErrorState message="Error al cargar permisos" onRetry={refetch} />
    );
  }

  const hasActiveFilters = columnFilters.length > 0;

  const clearAllFilters = () => {
    updateUrl({ group: null, type: null }, { resetPage: true });
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

  const handleExport = async (format: ListExportFormat) => {
    const options = {
      title: "Reporte de Permisos",
      filename: "reporte_permisos",
      generatedBy: getExportGeneratedBy(user),
      columns: ["Permiso", "Código", "Grupo", "Tipo"],
      data: matchingRows.map(({ original }) => [
        original.label,
        original.value,
        original.group,
        original.is_basic ? "Básico" : "Opcional",
      ]),
    };

    if (format === "pdf") {
      await exportToPdf(options);
      return;
    }
    await exportToExcel(options);
  };

  return (
    <div className="w-full space-y-4">
      <div className="space-y-4">
        <ListToolbarLayout
          search={
            <ListSearchInput
              value={globalFilter}
              onChange={(value) => updateUrl({ search: value || null }, { resetPage: true })}
              onClear={() => updateUrl({ search: null }, { resetPage: true })}
            />
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
            <Button
              variant="outline"
              onClick={() => updateUrl({ sort: null }, { resetPage: true })}
            >
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
              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
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

      <ListExportActions
        onExport={handleExport}
        disabled={isLoading || matchingRows.length === 0}
      />

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
                  className="hover:bg-muted/50"
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
