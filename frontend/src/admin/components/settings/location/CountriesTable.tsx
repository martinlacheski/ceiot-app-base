import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
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
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useCountries,
  useDeleteCountry,
  useUpdateCountry,
} from "@/admin/hooks/useLocations";
import {
  getCountriesAction,
  getStatesAction,
} from "@/admin/actions/location.actions";

// ... existing imports ...

// ... columns ...

// ...

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
import type { Country } from "@/interfaces/location.interface";
import { showConfirmDialog } from "@/store/confirm.store";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";
import { useAuthStore } from "@/auth/store/auth.store";
import { ViewCountryDialog } from "./ViewCountryDialog";
import {
  COUNTRY_SORT_OPTIONS,
  parseLocationSort,
  serializeLocationSort,
  toSortingState,
  type CountrySortField,
} from "./locationSort";

interface Props {
  actions?: React.ReactNode;
}

interface CountryMobileCardProps {
  country: Country;
  onView: (country: Country) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onRestore: (id: string, event: React.MouseEvent) => void;
}

function CountryMobileCard({
  country,
  onView,
  onEdit,
  onDelete,
  onRestore,
}: CountryMobileCardProps) {
  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden py-4"
      data-testid="country-mobile-card"
    >
      <CardHeader className="min-w-0 px-4">
        <CardTitle className="min-w-0 truncate pr-2">{country.name}</CardTitle>
        <CardAction>
          <Badge variant={country.isActive ? "default" : "secondary"}>
            {country.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex min-w-0 gap-2 px-4">
        <Button
          className="min-h-11 min-w-0 flex-1"
          onClick={() => onEdit(country.id)}
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
              aria-label={`Más acciones para ${country.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onView(country)}
              >
                <Eye />
                Ver detalles
              </DropdownMenuItem>
              {country.isActive ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onClick={(event) => onDelete(country.id, event)}
                >
                  <Trash2 />
                  Eliminar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="min-h-11"
                  onClick={(event) => onRestore(country.id, event)}
                >
                  <RotateCw />
                  Habilitar país
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export function CountriesTable({ actions }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") ?? "";
  const isActiveParam = searchParams.get("isActive") ?? "active"; // Default to active
  const parsedSort = parseLocationSort(
    searchParams.get("sort"),
    COUNTRY_SORT_OPTIONS,
  );
  const sorting = toSortingState(parsedSort.sort);
  const serializedSort = serializeLocationSort(parsedSort.sort);

  // Local UI State
  const [accordionValue, setAccordionValue] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);

  // Data Fetching
  const {
    data: countriesResponse,
    isLoading,
    isError,
    refetch,
  } = useCountries({
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

  const deleteMutation = useDeleteCountry();
  const updateMutation = useUpdateCountry();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Check for dependent states
    try {
      const statesCheck = await getStatesAction({ countryId: id, size: 1 });
      if (statesCheck.total > 0) {
        toast.warning(
          "No se puede eliminar este país porque tiene provincias asociadas. Elimine las provincias primero.",
        );
        return;
      }

      showConfirmDialog("¿Estás seguro de eliminar este país?", async () => {
        try {
          await deleteMutation.mutateAsync(id);
          toast.success("País eliminado exitosamente");
        } catch (error) {
          toast.error("Error al eliminar el país, error: " + error);
        }
      });
    } catch (error) {
      toast.error("Error al verificar dependencias del país, error: " + error);
    }
  };

  const handleRestore = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog("¿Estás seguro de habilitar este país?", async () => {
      try {
        await updateMutation.mutateAsync({ id, data: { is_active: true } });
        toast.success("País habilitado exitosamente");
      } catch (error) {
        toast.error("Error al habilitar el país, error: " + error);
      }
    });
  };

  const handleEdit = (id: string) => {
    navigate(`/admin/locations/countries/edit/${id}`);
  };

  const handleView = (country: Country) => {
    setSelectedCountry(country);
    setIsViewOpen(true);
  };

  // Export Handler
  const handleExport = async (format: "pdf" | "excel") => {
    try {
      setIsExporting(true);
      const toastId = toast.loading("Generando reporte...");

      // Fetch all data for export
      const response = await getCountriesAction({
        page: 1,
        size: 10000,
        search,
        isActive:
          isActiveParam === "active"
            ? true
            : isActiveParam === "inactive"
              ? false
              : undefined,
        sort: serializedSort,
      });

      const items = response.items;
      const exportOptions = {
        title: "Reporte de Países",
        filename: "reporte_paises",
        generatedBy: getExportGeneratedBy(currentUser),
        columns: ["Nombre", "Estado"],
        data: items.map((c: Country) => [
          c.name,
          c.isActive ? "Activo" : "Inactivo",
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
    const lastPage = countriesResponse?.pages;
    const total = countriesResponse?.total;
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
  }, [countriesResponse, page, searchParams, setSearchParams]);

  const updateSort = (field?: CountrySortField, direction = parsedSort.sort?.direction ?? "asc") => {
    updateSearchParam("sort", field ? serializeLocationSort({ field, direction }) ?? null : null);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    for (const key of ["search", "isActive", "sort"]) newParams.delete(key);
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  // Logic: Active filters exist if search is present OR isActive is NOT "active" (default)
  const hasActiveFilters =
    !!search || isActiveParam !== "active" || !!parsedSort.sort;

  const columns: ColumnDef<Country>[] = [
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
      id: "isActive",
      accessorFn: (country) => country.isActive,
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
        const country = row.original;
        return (
          <div className="flex items-center justify-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCountry(country);
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
                      handleEdit(country.id);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Editar</p>
                </TooltipContent>
              </Tooltip>

              {/* Delete/Restore Button */}
              {country.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => handleDelete(country.id, e)}
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
                      onClick={(e) => handleRestore(country.id, e)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar país</p>
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

  const handleSortingChange = (updater: Updater<typeof sorting>) => {
    const nextSorting = typeof updater === "function" ? updater(sorting) : updater;
    const next = nextSorting[0];
    updateSort(
      next?.id as CountrySortField | undefined,
      next?.desc ? "desc" : "asc",
    );
  };

  const table = useReactTable({
    data: countriesResponse?.items || [],
    columns,
    pageCount: countriesResponse?.pages ?? -1,
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
        message="Error al cargar países"
        onRetry={() => void refetch()}
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
            {actions}
          </>
        }
        secondaryActions={
          undefined
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
                  <Button variant="outline" size="sm" className="min-h-11" onClick={clearAllFilters}>
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
                <ListSortControls
                  options={COUNTRY_SORT_OPTIONS}
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

      <div className="flex items-center justify-between gap-4">
        <div />
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
        data-testid="countries-mobile-list"
      >
        {isLoading ? (
          Array.from({ length: 3 }, (_, index) => (
            <Card
              key={index}
              className="min-w-0 gap-4 py-4"
              data-testid="country-mobile-skeleton"
            >
              <CardHeader className="px-4">
                <Skeleton className="h-5 w-2/3" />
              </CardHeader>
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
              <CountryMobileCard
                key={row.id}
                country={row.original}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            ))
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No hay países registrados.
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
                  className="hover:bg-muted/50"
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
                  No hay países registrados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        totalItems={countriesResponse?.total}
        entityName="registros"
      />

      {selectedCountry && (
        <ViewCountryDialog
          open={isViewOpen}
          onOpenChange={setIsViewOpen}
          country={selectedCountry}
        />
      )}
    </div>
  );
}
