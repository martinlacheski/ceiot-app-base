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
  FileSpreadsheet,
  FileText,
  Filter,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { getCitiesAction } from "@/admin/actions/location.actions";
import {
  useCities,
  useCountries,
  useDeleteCity,
  useStates,
  useUpdateCity,
} from "@/admin/hooks/useLocations";
import { useAuthStore } from "@/auth/store/auth.store";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListSortControls } from "@/components/custom/ListSortControls";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { City } from "@/interfaces/location.interface";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";
import { showConfirmDialog } from "@/store/confirm.store";
import { ViewCityDialog } from "./ViewCityDialog";
import {
  CITY_SORT_OPTIONS,
  parseLocationSort,
  serializeLocationSort,
  toSortingState,
  useNormalizeInvalidLocationSort,
  type CitySortField,
} from "./locationSort";

interface Props {
  stateId?: string;
}

interface CityMobileCardProps {
  city: City;
  onView: (city: City) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onRestore: (id: string, event: React.MouseEvent) => void;
}

function CityMobileCard({
  city,
  onView,
  onEdit,
  onDelete,
  onRestore,
}: CityMobileCardProps) {
  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden py-4"
      data-testid="city-mobile-card"
    >
      <CardHeader className="min-w-0 px-4">
        <CardTitle className="min-w-0 truncate pr-2">{city.name}</CardTitle>
        <CardAction>
          <Badge variant={city.isActive ? "default" : "secondary"}>
            {city.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2 px-4 text-sm text-muted-foreground">
        <span className="min-w-0 break-words">
          Provincia: {city.state?.name || "-"}
        </span>
        <span className="min-w-0 break-words">
          País: {city.state?.country?.name || "-"}
        </span>
        {city.postalCode && (
          <span className="min-w-0 break-words">
            Código postal: {city.postalCode}
          </span>
        )}
      </CardContent>
      <CardFooter className="flex min-w-0 gap-2 px-4">
        <Button
          className="min-h-11 min-w-0 flex-1"
          onClick={() => onEdit(city.id)}
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
              aria-label={`Más acciones para ${city.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onView(city)}
              >
                <Eye />
                Ver detalles
              </DropdownMenuItem>
              {city.isActive ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onClick={(event) => onDelete(city.id, event)}
                >
                  <Trash2 />
                  Eliminar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="min-h-11"
                  onClick={(event) => onRestore(city.id, event)}
                >
                  <RotateCw />
                  Habilitar ciudad
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export function CitiesTable({ stateId: propStateId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // Dialog State
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);

  // Export State
  const [isExporting, setIsExporting] = useState(false);

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") ?? "";
  const isActiveParam = searchParams.get("isActive");
  const countryIdParam = searchParams.get("countryId");
  const stateIdParam = searchParams.get("stateId");
  const parsedSort = parseLocationSort(
    searchParams.get("sort"),
    CITY_SORT_OPTIONS,
  );
  const sorting = toSortingState(parsedSort.sort);
  const serializedSort = serializeLocationSort(parsedSort.sort);

  // Effective IDs (Prop takes precedence, then URL)
  const stateId = propStateId || stateIdParam || undefined;
  const countryId = propStateId ? undefined : countryIdParam || undefined;

  // Local UI State
  const [accordionValue, setAccordionValue] = useState<string>("");

  // Data Fetching
  const {
    data: citiesResponse,
    isLoading,
    isError,
    refetch,
  } = useCities({
    countryId,
    stateId,
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
            : true, // Default to active
    sort: serializedSort,
  });

  // Fetch Countries for filter
  const { data: countriesResponse } = useCountries({
    page: 1,
    size: 100,
    isActive: true, // Only show active countries in filter
  });
  const countries = countriesResponse?.items || [];

  // Fetch States for filter
  const { data: statesResponse } = useStates({
    countryId: countryId, // Filter states by selected country
    page: 1,
    size: 100, // Reasonable limit for dropdown
    isActive: true,
  });
  const states = statesResponse?.items || [];

  const deleteMutation = useDeleteCity();
  const updateMutation = useUpdateCity();

  const handleView = (city: City) => {
    setSelectedCity(city);
    setViewDialogOpen(true);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog("¿Estás seguro de eliminar esta ciudad?", async () => {
      try {
        await deleteMutation.mutateAsync(id);
        toast.success("Ciudad eliminada");
      } catch (error) {
        toast.error("Error al eliminar, error: " + error);
      }
    });
  };

  const handleRestore = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirmDialog("¿Estás seguro de habilitar esta ciudad?", async () => {
      try {
        await updateMutation.mutateAsync({ id, data: { is_active: true } });
        toast.success("Ciudad habilitada exitosamente");
      } catch (error) {
        toast.error("Error al habilitar la ciudad, error: " + error);
      }
    });
  };

  const handleEdit = (id: string) => {
    navigate(`/admin/locations/cities/edit/${id}`);
  };

  const handleCreate = () => {
    navigate("/admin/locations/cities/create");
  };

  // Export Handler
  const handleExport = async (format: "pdf" | "excel") => {
    try {
      setIsExporting(true);
      const toastId = toast.loading("Generando reporte...");

      // Fetch all data for export
      const response = await getCitiesAction({
        countryId,
        stateId,
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
        title: "Reporte de Ciudades",
        filename: "reporte_ciudades",
        generatedBy: getExportGeneratedBy(currentUser),
        columns: ["Nombre", "Provincia", "País", "Código Postal", "Estado"],
        data: items.map((city: City) => [
          city.name,
          city.state?.name || "-",
          city.state?.country?.name || "-",
          city.postalCode ?? "-",
          city.isActive ? "Activo" : "Inactivo",
        ]),
      };

      if (format === "excel") {
        await exportToExcel(exportOptions);
      } else {
        await exportToPdf(exportOptions);
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
    // If changing Country, reset State
    if (key === "countryId") {
      newParams.delete("stateId");
    }
    newParams.set("page", "1"); // Reset to first page
    setSearchParams(newParams);
  };

  useNormalizeInvalidLocationSort(parsedSort.isValid, () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("sort");
    newParams.set("page", "1");
    setSearchParams(newParams, { replace: true });
  });

  useEffect(() => {
    const lastPage = citiesResponse?.pages;
    const total = citiesResponse?.total;
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
  }, [citiesResponse, page, searchParams, setSearchParams]);

  const updateSort = (
    field?: CitySortField,
    direction = parsedSort.sort?.direction ?? "asc",
  ) => {
    updateSearchParam(
      "sort",
      field ? serializeLocationSort({ field, direction }) ?? null : null,
    );
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    for (const key of ["search", "isActive", "countryId", "stateId", "sort"])
      newParams.delete(key);
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const hasActiveFilters =
    !!search ||
    !!isActiveParam ||
    !!countryIdParam ||
    (!!stateIdParam && !propStateId) ||
    !!parsedSort.sort;

  const columns: ColumnDef<City>[] = [
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
      id: "stateName",
      accessorFn: (city) => city.state?.name,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Provincia"
          className="justify-center"
          hideReset
          triggerClassName="min-h-11"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.state?.name || "-"}</div>
      ),
    },
    {
      id: "countryName",
      accessorFn: (city) => city.state?.country?.name,
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
        <div className="text-center">
          {row.original.state?.country?.name || "-"}
        </div>
      ),
    },
    {
      id: "postalCode",
      accessorFn: (city) => city.postalCode,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Código Postal"
          className="justify-center"
          hideReset
          triggerClassName="min-h-11"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.postalCode}</div>
      ),
    },
    {
      id: "isActive",
      accessorFn: (city) => city.isActive,
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
        const city = row.original;
        return (
          <div className="flex gap-2 justify-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => handleView(city)}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ver detalles</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => handleEdit(city.id)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Editar</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              {city.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => handleDelete(city.id, e)}
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
                      onClick={(e) => handleRestore(city.id, e)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar ciudad</p>
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
      next?.id as CitySortField | undefined,
      next?.desc ? "desc" : "asc",
    );
  };

  const table = useReactTable({
    data: citiesResponse?.items || [],
    columns,
    pageCount: citiesResponse?.pages ?? -1,
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
        message="Error al cargar ciudades"
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
              <Plus className="mr-2 h-4 w-4" /> Nueva Ciudad
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
                  <Select
                    value={isActiveParam ?? "active"}
                    onValueChange={(value) =>
                      updateSearchParam(
                        "isActive",
                        value === "all" ? "all" : value,
                      )
                    }
                  >
                    <SelectTrigger className="min-h-11 w-full">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="active">Activo</SelectItem>
                      <SelectItem value="inactive">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">País</label>
                  <Select
                    value={countryIdParam ?? "all"}
                    onValueChange={(value) =>
                      updateSearchParam(
                        "countryId",
                        value === "all" ? null : value,
                      )
                    }
                  >
                    <SelectTrigger className="min-h-11 w-full">
                      <SelectValue placeholder="Todos los países" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los países</SelectItem>
                      {countries.map(
                        (country: { id: string; name: string }) => (
                          <SelectItem key={country.id} value={country.id}>
                            {country.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {!propStateId && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provincia</label>
                    <Select
                      value={stateIdParam ?? "all"}
                      onValueChange={(value) =>
                        updateSearchParam(
                          "stateId",
                          value === "all" ? null : value,
                        )
                      }
                    >
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder="Todas las provincias" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          Todas las provincias
                        </SelectItem>
                        {states.map((state: { id: string; name: string }) => (
                          <SelectItem key={state.id} value={state.id}>
                            {state.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <ListSortControls
                  options={CITY_SORT_OPTIONS}
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
        data-testid="cities-mobile-list"
      >
        {isLoading ? (
          Array.from({ length: 3 }, (_, index) => (
            <Card
              key={index}
              className="min-w-0 gap-4 py-4"
              data-testid="city-mobile-skeleton"
            >
              <CardHeader className="px-4">
                <Skeleton className="h-5 w-2/3" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
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
              <CityMobileCard
                key={row.id}
                city={row.original}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            ))
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No hay ciudades registradas.
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
                  // remove click handler
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
                  No hay ciudades registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        totalItems={citiesResponse?.total}
        entityName="registros"
      />

      {selectedCity && (
        <ViewCityDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          city={selectedCity}
        />
      )}
    </div>
  );
}
