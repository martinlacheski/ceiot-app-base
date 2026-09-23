/* eslint-disable @typescript-eslint/no-explicit-any */
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
  RotateCw,
  Trash2,
  X,
  ChevronRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { getStatesAction } from "@/admin/actions/location.actions";
import {
  useCountries,
  useDeleteState,
  useStates,
  useUpdateState,
} from "@/admin/hooks/useLocations";
import { useAuthStore } from "@/auth/store/auth.store";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import { ListSortControls } from "@/components/custom/ListSortControls";
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
  CardContent,
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
import type { State } from "@/interfaces/location.interface";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";
import { showConfirmDialog } from "@/store/confirm.store";
import { ViewStateDialog } from "./ViewStateDialog";
import {
  parseLocationSort,
  serializeLocationSort,
  STATE_SORT_OPTIONS,
  toSortingState,
  type StateSortField,
} from "./locationSort";

interface Props {
  countryId?: string;
  onSelectState?: (state: State) => void;
}

interface StateMobileCardProps {
  state: State;
  onSelectState?: (state: State) => void;
  onView: (state: State) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onRestore: (id: string, event: React.MouseEvent) => void;
}

function StateMobileCard({
  state,
  onSelectState,
  onView,
  onEdit,
  onDelete,
  onRestore,
}: StateMobileCardProps) {
  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden py-4"
      data-testid="state-mobile-card"
    >
      <CardHeader className="min-w-0 px-4">
        <CardTitle className="min-w-0 truncate pr-2">{state.name}</CardTitle>
        <CardAction>
          <Badge variant={state.isActive ? "default" : "secondary"}>
            {state.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0 px-4 text-sm text-muted-foreground">
        <span className="min-w-0 break-words">
          País: {state.country?.name || "-"}
        </span>
      </CardContent>
      <CardFooter className="flex min-w-0 gap-2 px-4">
        <Button
          className="min-h-11 min-w-0 flex-1"
          onClick={() => onEdit(state.id)}
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
              aria-label={`Más acciones para ${state.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {onSelectState && (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => onSelectState(state)}
                >
                  <ChevronRight />
                  Ver ciudades
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onView(state)}
              >
                <Eye />
                Ver detalles
              </DropdownMenuItem>
              {state.isActive ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onClick={(event) => onDelete(state.id, event)}
                >
                  <Trash2 />
                  Eliminar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="min-h-11"
                  onClick={(event) => onRestore(state.id, event)}
                >
                  <RotateCw />
                  Habilitar provincia
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export function StatesTable({
  countryId: propCountryId,
  onSelectState,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") ?? "";
  const isActiveParam = searchParams.get("isActive") ?? "active";
  const countryIdParam = searchParams.get("countryId");
  const parsedSort = parseLocationSort(
    searchParams.get("sort"),
    STATE_SORT_OPTIONS,
  );
  const sorting = toSortingState(parsedSort.sort);
  const serializedSort = serializeLocationSort(parsedSort.sort);

  // Effective Country ID (Prop takes precedence, then URL)
  const countryId = propCountryId || countryIdParam || undefined;

  // Local UI State
  const [accordionValue, setAccordionValue] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedState, setSelectedState] = useState<State | null>(null);

  // Data Fetching
  const {
    data: statesResponse,
    isLoading,
    isError,
    refetch,
  } = useStates({
    countryId,
    page,
    size,
    search,
    isActive:
      isActiveParam === "active"
        ? true
        : isActiveParam === "inactive"
          ? false
          : isActiveParam === "all"
            ? undefined
            : true, // Default to active if param is missing (initial load)
    sort: serializedSort,
  });

  const { data: countriesResponse } = useCountries({
    page: 1,
    size: 100,
    isActive: true, // Only show active countries in filter
  });
  const countries = countriesResponse?.items || [];

  const deleteMutation = useDeleteState();
  const updateMutation = useUpdateState();

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog("¿Estás seguro de eliminar esta provincia?", async () => {
      try {
        await deleteMutation.mutateAsync(id);
        toast.success("Provincia eliminada");
      } catch (error) {
        toast.error("Error al eliminar, error: " + error);
      }
    });
  };

  const handleRestore = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog(
      "¿Estás seguro de habilitar esta provincia?",
      async () => {
        try {
          await updateMutation.mutateAsync({ id, data: { is_active: true } });
          toast.success("Provincia habilitada exitosamente");
        } catch (error) {
          toast.error("Error al habilitar la provincia, error: " + error);
        }
      },
    );
  };

  const handleEdit = (id: string) => {
    navigate(`/admin/locations/states/edit/${id}`);
  };

  const handleView = (state: State) => {
    setSelectedState(state);
    setIsViewOpen(true);
  };

  const handleCreate = () => {
    navigate("/admin/locations/states/create");
  };

  // Export Handler
  const handleExport = async (format: "pdf" | "excel") => {
    try {
      setIsExporting(true);
      const toastId = toast.loading("Generando reporte...");

      // Fetch all data for export
      const response = await getStatesAction({
        countryId,
        page: 1,
        size: 10000,
        search,
        isActive:
          isActiveParam === "active"
            ? true
            : isActiveParam === "inactive"
              ? false
              : isActiveParam === "all"
                ? undefined
                : true,
        sort: serializedSort,
      });

      const items = response.items;
      const exportOptions = {
        title: "Reporte de Provincias",
        filename: "reporte_provincias",
        generatedBy: getExportGeneratedBy(currentUser),
        columns: ["Nombre", "País", "Estado"],
        data: items.map((s: State) => [
          s.name,
          s.country?.name || "-",
          s.isActive ? "Activo" : "Inactivo",
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

  useEffect(() => {
    if (parsedSort.isValid) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("sort");
    newParams.set("page", "1");
    setSearchParams(newParams, { replace: true });
  }, [parsedSort.isValid, searchParams, setSearchParams]);

  useEffect(() => {
    const lastPage = statesResponse?.pages;
    const total = statesResponse?.total;
    if (
      !total ||
      total <= 0 ||
      !lastPage ||
      lastPage <= 0 ||
      page <= lastPage
    ) {
      return;
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", lastPage.toString());
    setSearchParams(newParams, { replace: true });
  }, [page, searchParams, setSearchParams, statesResponse]);

  const updateSort = (
    field?: StateSortField,
    direction = parsedSort.sort?.direction ?? "asc",
  ) => {
    updateSearchParam(
      "sort",
      field ? serializeLocationSort({ field, direction }) ?? null : null,
    );
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    for (const key of ["search", "isActive", "countryId", "sort"])
      newParams.delete(key);
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const hasActiveFilters =
    !!search ||
    isActiveParam !== "active" ||
    (!!countryIdParam && !propCountryId) ||
    !!parsedSort.sort;

  const columns: ColumnDef<State>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Nombre"
          className="justify-center"
          hideReset
          triggerClassName="min-h-11"
        />
      ),
      cell: ({ row }) => (
        <div className="font-medium text-center">{row.getValue("name")}</div>
      ),
    },
    {
      id: "countryName",
      accessorFn: (state) => state.country?.name,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="País"
          className="justify-center"
          hideReset
          triggerClassName="min-h-11"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.country?.name || "-"}</div>
      ),
    },
    {
      id: "isActive",
      accessorFn: (state) => state.isActive,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Estado"
          className="justify-center"
          hideReset
          triggerClassName="min-h-11"
        />
      ),
      cell: ({ row }) => {
        const isActive = row.original.isActive;
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
        const state = row.original;
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
                      if (onSelectState) {
                        onSelectState(state);
                      }
                    }}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ver ciudades</p>
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
                      setSelectedState(state);
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
                      handleEdit(state.id);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Editar</p>
                </TooltipContent>
              </Tooltip>

              {state.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => handleDelete(state.id, e)}
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
                      onClick={(e) => handleRestore(state.id, e)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar provincia</p>
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
    [page, size],
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
    const next = nextSorting[0];
    updateSort(
      next?.id as StateSortField | undefined,
      next?.desc ? "desc" : "asc",
    );
  };

  const table = useReactTable({
    data: statesResponse?.items || [],
    columns,
    pageCount: statesResponse?.pages ?? -1,
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
    enableMultiSort: false,
  });

  if (isError) {
    return (
      <ListErrorState
        message="Error al cargar provincias"
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
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
              className="min-h-11"
              onClick={() =>
                setAccordionValue(
                  accordionValue === "advance-filters" ? "" : "advance-filters",
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
              <Plus className="mr-2 h-4 w-4" /> Nueva Provincia
            </Button>
          </>
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={clearAllFilters}
                  >
                    Limpiar todos
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Estado</label>
                  <select
                    className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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

                {!propCountryId && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">País</label>
                    <select
                      className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={countryIdParam ?? "all"}
                      onChange={(e) =>
                        updateSearchParam(
                          "countryId",
                          e.target.value === "all" ? null : e.target.value,
                        )
                      }
                    >
                      <option value="all">Todos los países</option>
                      {countries.map((country: any) => (
                        <option key={country.id} value={country.id}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <ListSortControls
                  options={STATE_SORT_OPTIONS}
                  value={parsedSort.sort?.field}
                  direction={parsedSort.sort?.direction ?? "asc"}
                  onValueChange={updateSort}
                  onDirectionChange={(direction) =>
                    updateSort(parsedSort.sort?.field, direction)
                  }
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex items-center justify-end gap-4">
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
        data-testid="states-mobile-list"
      >
        {isLoading ? (
          Array.from({ length: 3 }, (_, index) => (
            <Card
              key={index}
              className="min-w-0 gap-4 py-4"
              data-testid="state-mobile-skeleton"
            >
              <CardHeader className="px-4">
                <Skeleton className="h-5 w-2/3" />
              </CardHeader>
              <CardContent className="px-4">
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
              <CardFooter className="gap-2 px-4">
                <Skeleton className="h-11 flex-1" />
                <Skeleton className="size-11" />
              </CardFooter>
            </Card>
          ))
        ) : table.getRowModel().rows.length ? (
          table
            .getRowModel()
            .rows.map((row) => (
              <StateMobileCard
                key={row.id}
                state={row.original}
                onSelectState={onSelectState}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            ))
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No hay provincias registradas.
          </p>
        )}
      </div>

      <div className="hidden rounded-md border bg-card text-card-foreground md:block">
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
                          header.getContext(),
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
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
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
                  No hay provincias registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        totalItems={statesResponse?.total}
        entityName="registros"
      />

      {selectedState && (
        <ViewStateDialog
          open={isViewOpen}
          onOpenChange={setIsViewOpen}
          state={selectedState}
        />
      )}
    </div>
  );
}
