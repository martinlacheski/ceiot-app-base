import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import {
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useDeleteEnvironmentType,
  useEnvironmentTypes,
  useUpdateEnvironmentType,
} from "@/admin/hooks/useEnvironment";
import { getEnvironmentTypesAction } from "@/admin/actions/environment.actions";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
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
  CardAction,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EnvironmentTypeListItem } from "@/interfaces/environment.interface";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { showConfirmDialog } from "@/store/confirm.store";
import { useAuthStore } from "@/auth/store/auth.store";
import { toPositiveInt } from "@/utils/url-params";
import { ViewEnvironmentTypeDialog } from "./ViewEnvironmentTypeDialog";

interface EnvironmentTypeMobileCardProps {
  environmentType: EnvironmentTypeListItem;
  onView: (environmentType: EnvironmentTypeListItem) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onRestore: (id: string, event: React.MouseEvent) => void;
}

const ENVIRONMENT_TYPE_SORT_COLUMNS = new Set(["name", "is_active"]);

function parseSorting(rawSort: string | null): SortingState {
  if (!rawSort) return [];

  const sorting = rawSort.split(",").map((entry) => {
    const [id, direction, ...rest] = entry.split(":");
    if (
      rest.length > 0 ||
      !ENVIRONMENT_TYPE_SORT_COLUMNS.has(id) ||
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

function serializeSorting(sorting: SortingState): string | undefined {
  return sorting.length > 0
    ? sorting.map(({ id, desc }) => `${id}:${desc ? "desc" : "asc"}`).join(",")
    : undefined;
}

function EnvironmentTypeMobileCard({
  environmentType,
  onView,
  onEdit,
  onDelete,
  onRestore,
}: EnvironmentTypeMobileCardProps) {
  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden py-4"
      data-testid="environment-type-mobile-card"
    >
      <CardHeader className="min-w-0 px-4">
        <CardTitle className="min-w-0 truncate pr-2">
          {environmentType.name}
        </CardTitle>
        <CardAction>
          <Badge variant={environmentType.is_active ? "default" : "secondary"}>
            {environmentType.is_active ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex min-w-0 gap-2 px-4">
        <Button
          className="min-h-11 min-w-0 flex-1"
          onClick={() => onEdit(environmentType.id)}
        >
          <Pencil data-icon="inline-start" />
          Editar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label={`Más acciones para ${environmentType.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onView(environmentType)}
              >
                <Eye />
                Ver detalles
              </DropdownMenuItem>
              {environmentType.is_active ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onClick={(event) => onDelete(environmentType.id, event)}
                >
                  <Trash2 />
                  Eliminar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="min-h-11"
                  onClick={(event) => onRestore(environmentType.id, event)}
                >
                  <RotateCw />
                  Habilitar tipo de establecimiento
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export function EnvironmentTypesTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") ?? "";
  const isActiveParam = searchParams.get("isActive") ?? "active"; // Default to active
  const sorting = useMemo(
    () => parseSorting(searchParams.get("sort")),
    [searchParams],
  );
  const serializedSort = serializeSorting(sorting);

  // Local UI State
  const [accordionValue, setAccordionValue] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<EnvironmentTypeListItem | null>(
    null
  );

  // Data Fetching
  const {
    data: environmentTypesResponse,
    isLoading,
    isError,
    refetch,
  } = useEnvironmentTypes({
    page,
    size,
    search,
    isActive:
      isActiveParam === "active"
        ? true
        : isActiveParam === "inactive"
        ? false
        : undefined,
    sort: serializedSort,
  });

  useEffect(() => {
    const lastPage = environmentTypesResponse?.pages;
    const total = environmentTypesResponse?.total;
    if (!total || total <= 0 || !lastPage || lastPage <= 0 || page <= lastPage)
      return;

    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", lastPage.toString());
    setSearchParams(newParams, { replace: true });
  }, [environmentTypesResponse, page, searchParams, setSearchParams]);

  const deleteMutation = useDeleteEnvironmentType();
  const updateMutation = useUpdateEnvironmentType();

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog(
      "¿Estás seguro de eliminar este tipo de establecimiento?",
      async () => {
        try {
          await deleteMutation.mutateAsync(id);
          toast.success("Tipo de establecimiento eliminado");
        } catch (error) {
          toast.error("Error al eliminar, error: " + error);
        }
      }
    );
  };

  const handleRestore = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog(
      "¿Estás seguro de habilitar este tipo de establecimiento?",
      async () => {
        try {
          await updateMutation.mutateAsync({ id, data: { is_active: true } });
          toast.success("Tipo de establecimiento habilitado correctamente");
        } catch (error) {
          toast.error("Error al habilitar, error: " + error);
        }
      }
    );
  };

  const handleEdit = (id: string) => {
    navigate(`/admin/environments/types/edit/${id}`);
  };

  const handleView = (environmentType: EnvironmentTypeListItem) => {
    setSelectedItem(environmentType);
    setIsViewOpen(true);
  };

  const handleCreate = () => {
    navigate("/admin/environments/types/create");
  };

  // Export Handler
  const handleExport = async (format: "pdf" | "excel") => {
    try {
      setIsExporting(true);
      const toastId = toast.loading("Generando reporte...");

      // Fetch all data for export
      const response = await getEnvironmentTypesAction({
        page: 1,
        per_page: 10000,
        search,
        is_active:
          isActiveParam === "active"
            ? true
            : isActiveParam === "inactive"
            ? false
            : undefined,
        sort: serializedSort,
      });

      const items = response.items;
      const exportOptions = {
        title: "Reporte de Tipos de Establecimiento",
        filename: "reporte_tipos_establecimiento",
        generatedBy: getExportGeneratedBy(currentUser),
        columns: ["Nombre", "Estado"],
        data: items.map((item: EnvironmentTypeListItem) => [
          item.name,
          item.is_active ? "Activo" : "Inactivo",
        ]),
      };

      if (format === "pdf") {
        await exportToPdf(exportOptions);
      } else {
        await exportToExcel(exportOptions);
      }

      toast.success("Reporte generado correctamente", { id: toastId });
    } catch (error) {
      toast.error("Error al generar el reporte, error: " + error);
    } finally {
      setIsExporting(false);
    }
  };

  // URL Updates helpers
  const updateSearchParam = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.set("page", "1"); // Reset to first page
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams();
    newParams.set("isActive", "active");
    setSearchParams(newParams);
  };

  // Logic: Active filters exist if search is present OR isActive is NOT "active" (default)
  const hasActiveFilters = !!search || isActiveParam !== "active";

  const columns: ColumnDef<EnvironmentTypeListItem>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Nombre"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="font-medium text-center">{row.getValue("name")}</div>
      ),
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Estado"
          className="justify-center"
        />
      ),
      cell: ({ row }) => {
        const isActive = row.original.is_active;
        return (
          <div className="flex justify-center">
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "Activo" : "Inactivo"}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-center">Acciones</div>,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex gap-2 justify-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem(item);
                      setIsViewOpen(true);
                    }}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ver detalles</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(item.id);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Editar</p>
                </TooltipContent>
              </Tooltip>

              {item.is_active ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => handleDelete(item.id, e)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Eliminar</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => handleRestore(item.id, e)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar tipo de establecimiento</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>
        );
      },
    },
  ];

  const paginationState: PaginationState = useMemo(
    () => ({
      pageIndex: page - 1,
      pageSize: size,
    }),
    [page, size]
  );

  const handlePaginationChange = (updater: Updater<PaginationState>) => {
    const nextPagination =
      typeof updater === "function" ? updater(paginationState) : updater;
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", (nextPagination.pageIndex + 1).toString());
    newParams.set("size", nextPagination.pageSize.toString());
    setSearchParams(newParams);
  };

  const handleSortingChange = (updater: Updater<SortingState>) => {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    const newParams = new URLSearchParams(searchParams);
    const nextSort = serializeSorting(nextSorting);
    if (nextSort) {
      newParams.set("sort", nextSort);
    } else {
      newParams.delete("sort");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const table = useReactTable({
    data: environmentTypesResponse?.items || [],
    columns,
    pageCount: environmentTypesResponse?.pages ?? -1,
    state: {
      pagination: paginationState,
      sorting,
    },
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  if (isError) {
    return (
      <ListErrorState
        message="Error al cargar tipos de establecimiento"
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="w-full space-y-4">
      <ListToolbarLayout
        search={
          <div className="relative w-full">
            <Input
              placeholder="Buscar en todos los campos..."
              value={search}
              onChange={(e) => updateSearchParam("search", e.target.value)}
              className="pr-8"
              data-list-toolbar-search-control
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 size-11 -translate-y-1/2"
                onClick={() => updateSearchParam("search", null)}
                aria-label="Limpiar búsqueda"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        }
        primaryActions={
          <>
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
              <Filter className="mr-2 size-4" />
              Filtros
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-2">
                  !
                </Badge>
              )}
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo Tipo
            </Button>
          </>
        }
        secondaryActions={
          sorting.length > 0 ? (
            <Button variant="outline" onClick={() => handleSortingChange([])}>
              <RotateCcw className="mr-2 size-4" />
              Resetear orden
            </Button>
          ) : undefined
        }
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
                  <Button variant="outline" size="sm" onClick={clearAllFilters}>
                    Limpiar todos
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Estado</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    value={isActiveParam}
                    onChange={(e) =>
                      updateSearchParam("isActive", e.target.value)
                    }
                  >
                    <option value="all">Todos</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Tip:</span> Para ordenar por múltiples
          columnas, mantener presionada la tecla <strong>Shift</strong> al hacer
          clic en los encabezados.
        </p>
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handleExport("excel")}
                  disabled={isExporting}
                >
                  <FileSpreadsheet className="size-4 text-green-600" />
                  <span className="hidden sm:inline">Excel</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exportar a Excel</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handleExport("pdf")}
                  disabled={isExporting}
                >
                  <FileText className="size-4 text-red-600" />
                  <span className="hidden sm:inline">PDF</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exportar a PDF</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div
        className="flex min-w-0 flex-col gap-3 md:hidden"
        data-testid="environment-types-mobile-list"
      >
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <Card
              key={index}
              className="gap-4 py-4"
              data-testid="environment-type-mobile-skeleton"
            >
              <CardHeader className="px-4">
                <Skeleton className="h-5 w-2/3" />
                <CardAction>
                  <Skeleton className="h-5 w-16" />
                </CardAction>
              </CardHeader>
              <CardFooter className="gap-2 px-4">
                <Skeleton className="h-11 flex-1" />
                <Skeleton className="size-11" />
              </CardFooter>
            </Card>
          ))
        ) : table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <EnvironmentTypeMobileCard
              key={row.id}
              environmentType={row.original}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRestore={handleRestore}
            />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay tipos de establecimiento registrados.
          </p>
        )}
      </div>

      <div
        className="hidden rounded-md border bg-card text-card-foreground md:block"
        data-testid="environment-types-desktop-table"
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
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="hover:bg-muted/50"
                  onClick={() => {
                    // No specific onSelect for now
                  }}
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
                  No hay tipos de establecimiento registrados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        totalItems={environmentTypesResponse?.total}
        entityName="registros"
      />

      {selectedItem && (
        <ViewEnvironmentTypeDialog
          open={isViewOpen}
          onOpenChange={setIsViewOpen}
          environmentType={selectedItem}
        />
      )}
    </div>
  );
}
