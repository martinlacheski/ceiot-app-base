import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getFilteredRowModel,
  type PaginationState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import {
  Edit,
  Filter,
  Trash2,
  FileSpreadsheet,
  FileText,
  MapPin,
  Eye,
  X,
  Loader2,
  RotateCw,
  MoreVertical,
} from "lucide-react";
import {
  ENVIRONMENT_ROLE,
  ENVIRONMENT_SORT_BY,
  type Environment,
  type EnvironmentSortBy,
  type SortOrder,
} from "@/app/types/environment.types";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { CenteredHeader } from "@/components/custom/CenteredHeader";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { useNavigate, useSearchParams } from "react-router";
import { environmentService } from "@/app/services/environment.service";
import {
  useDeleteEnvironment,
  useUpdateEnvironment,
  useEnvironments,
  useEnvironmentTypes,
} from "@/app/hooks/useEnvironments";

import { useCountries, useStates, useCities } from "@/admin/hooks/useLocations";
import { useUsers } from "@/admin/hooks/useUsers";
import { showConfirmDialog } from "@/store/confirm.store";
import { EnvironmentDetailDialog } from "./EnvironmentDetailDialog";
import { useAuthStore } from "@/auth/store/auth.store";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";
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
import {
  applySortingUpdate,
  toSortingState,
  type ServerSort,
} from "@/lib/serverSorting";

interface EnvironmentsTableProps {
  actions?: React.ReactNode;
}

const DEFAULT_SORT_BY: EnvironmentSortBy = ENVIRONMENT_SORT_BY.NAME;
const DEFAULT_SORT_ORDER: SortOrder = "asc";

function isEnvironmentSortBy(value: string | null): value is EnvironmentSortBy {
  return Object.values(ENVIRONMENT_SORT_BY).some((option) => option === value);
}

function isSortOrder(value: string | null): value is SortOrder {
  return value === "asc" || value === "desc";
}

interface EnvironmentMobileCardProps {
  environment: Environment;
  currentUserId?: string;
  isAdmin?: boolean;
  onView: (environment: Environment) => void;
  onEdit: (environment: Environment) => void;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
}

export function EnvironmentMobileCard({
  environment,
  currentUserId,
  isAdmin,
  onView,
  onEdit,
  onDelete,
  onReactivate,
}: EnvironmentMobileCardProps) {
  const canEdit = Boolean(
    environment.canEdit ?? isAdmin ?? environment.ownerId === currentUserId,
  );
  const canDelete = Boolean(
    environment.canDelete ?? isAdmin ?? environment.ownerId === currentUserId,
  );
  const role =
    environment.currentUserRole ??
    (environment.ownerId === currentUserId ? ENVIRONMENT_ROLE.OWNER : null);
  const roleLabel =
    role === ENVIRONMENT_ROLE.OWNER
      ? "Propietario"
      : role === ENVIRONMENT_ROLE.GUEST
        ? "Invitado"
        : null;

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="gap-3 px-4">
        <CardTitle className="min-w-0 break-words pr-2 text-base">
          {environment.name}
        </CardTitle>
        <CardAction>
          <Badge variant={environment.isActive ? "default" : "destructive"}>
            {environment.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        {environment.type?.name ? (
          <p>
            <span className="font-medium">Tipo:</span> {environment.type.name}
          </p>
        ) : null}
        {roleLabel ? (
          <p>
            <span className="font-medium">Rol:</span> {roleLabel}
          </p>
        ) : null}
        {environment.address ? (
          <p className="break-words">
            <span className="font-medium">Dirección:</span> {environment.address}
          </p>
        ) : null}
        {environment.ownerName ? (
          <p>
            <span className="font-medium">Dueño:</span> {environment.ownerName}
          </p>
        ) : null}
        {environment.location ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${environment.location}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MapPin />
            Ver ubicación
          </a>
        ) : null}
      </CardContent>

      <CardFooter className="gap-2 px-4">
        <Button className="min-h-11 flex-1" onClick={() => onView(environment)}>
          <Eye />
          Ver detalles
        </Button>

        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`Más acciones para ${environment.name}`}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {canEdit ? (
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => onEdit(environment)}
                  >
                    <Edit />
                    Editar
                  </DropdownMenuItem>
                ) : null}
                {canDelete && environment.isActive ? (
                  <DropdownMenuItem
                    className="min-h-11"
                    variant="destructive"
                    onSelect={() => onDelete(environment.id)}
                  >
                    <Trash2 />
                    Eliminar
                  </DropdownMenuItem>
                ) : canDelete ? (
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => onReactivate(environment.id)}
                  >
                    <RotateCw />
                    Habilitar
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function EnvironmentsTable({ actions }: EnvironmentsTableProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;

  // Dialog State
  const [selectedEnvironment, setSelectedEnvironment] =
    useState<Environment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") || "";
  const statusFilter = searchParams.get("status") || "active";
  const typeId = searchParams.get("typeId") || undefined;
  const ownerId = searchParams.get("ownerId") || undefined;
  const countryId = searchParams.get("countryId") || undefined;
  const stateId = searchParams.get("stateId") || undefined;
  const cityId = searchParams.get("cityId") || undefined;
  const sortByParam = searchParams.get("sortBy");
  const sortOrderParam = searchParams.get("sortOrder");
  const sortBy = isEnvironmentSortBy(sortByParam)
    ? sortByParam
    : DEFAULT_SORT_BY;
  const sortOrder = isSortOrder(sortOrderParam)
    ? sortOrderParam
    : DEFAULT_SORT_ORDER;

  // Local State
  const [rowSelection, setRowSelection] = useState({});
  const [accordionValue, setAccordionValue] = useState<string>("");

  // --- Data Fetching ---

  // Main Environments Query
  // Data Fetching
  // Data Fetching
  const { data, isLoading, isError, refetch } = useEnvironments({
    page,
    perPage: size,
    search,
    isActive:
      statusFilter === "active"
        ? true
        : statusFilter === "inactive"
          ? false
          : undefined,
    countryId: countryId || undefined,
    stateId: stateId || undefined,
    cityId: cityId || undefined,
    typeId: typeId || undefined,
    userId: ownerId || undefined,
    sortBy,
    sortOrder,
  });

  useEffect(() => {
    if (!data || data.total < 1 || data.pages < 1 || page <= data.pages) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(data.pages));
    setSearchParams(nextParams, { replace: true });
  }, [data?.pages, data?.total, page, searchParams, setSearchParams]);

  // Filter Options Queries
  const { data: typesData } = useEnvironmentTypes();

  const { data: usersData } = useUsers(
    {
      page: 1,
      size: 100,
      isActive: true, // Only show active users in filter
    },
    { enabled: isAdmin },
  );

  const { data: countriesData } = useCountries({
    page: 1,
    size: 100,
    isActive: true,
  });

  const { data: statesData } = useStates({
    countryId: countryId || undefined,
    page: 1,
    size: 100,
    isActive: true,
  });

  const { data: citiesData } = useCities({
    countryId: countryId || undefined, // Optional optimization
    stateId: stateId || undefined,
    page: 1,
    size: 100,
    isActive: true,
  });

  // Mutations
  const deleteEnvironment = useDeleteEnvironment();
  const updateEnvironment = useUpdateEnvironment();

  // Export
  const handleExport = (format: "excel" | "pdf") => {
    environmentService.export(format, {
      page: 1,
      perPage: 1000,
      search,
      isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      typeId,
      userId: ownerId,
      countryId,
      stateId,
      cityId,
      sortBy,
      sortOrder,
    }, {
      generatedBy: getExportGeneratedBy(user),
    });
  };

  // Handlers
  const handleEdit = (env: Environment) => {
    navigate(`/app/environments/${env.id}/edit`);
  };

  const handleView = (env: Environment) => {
    setSelectedEnvironment(env);
    setDetailOpen(true);
  };

  const handleDelete = (id: string) => {
    showConfirmDialog(
      "¿Estás seguro de que deseas eliminar este establecimiento?",
      async () => {
        await deleteEnvironment.mutateAsync(id);
      },
    );
  };

  const handleReactivate = (id: string) => {
    showConfirmDialog(
      "¿Estás seguro de habilitar este establecimiento?",
      async () => {
        await updateEnvironment.mutateAsync({
          id,
          environment: { isActive: true },
        });
      },
    );
  };

  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      // For status, we want to keep "all" explicitly to override the default "active" fallback
      if (key === "status" && value === "all") {
        newParams.set(key, String(value));
      } else if (value === null || value === "" || value === "all") {
        newParams.delete(key);
      } else {
        newParams.set(key, String(value));
      }
    });
    // Reset page on filter change
    if (!updates.page) {
      newParams.set("page", "1");
    }
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams();
    newParams.set("status", "active");
    // Preserve pagination size if desired, or reset
    newParams.set("size", String(size));
    newParams.set("page", "1");
    newParams.set("sortBy", DEFAULT_SORT_BY);
    newParams.set("sortOrder", DEFAULT_SORT_ORDER);
    setSearchParams(newParams);
  };

  const hasActiveFilters =
    !!search ||
    statusFilter !== "active" ||
    !!typeId ||
    !!ownerId ||
    !!countryId ||
    !!stateId ||
    !!cityId ||
    sortBy !== DEFAULT_SORT_BY ||
    sortOrder !== DEFAULT_SORT_ORDER;

  // Columns
  const columns: ColumnDef<Environment>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Nombre" align="center" />
      ),
      cell: ({ row }) => (
        <div className="font-medium text-center max-w-[200px] mx-auto whitespace-normal break-words">
          {row.getValue("name")}
        </div>
      ),
    },
    {
      id: "type",
      accessorFn: (environment) => environment.type?.name || "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tipo" align="center" />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.type?.name || "-"}</div>
      ),
    },
    {
      id: "owner",
      accessorFn: (environment) => environment.ownerName || "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Dueño" align="center" />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.ownerName || "-"}</div>
      ),
    },
    {
      accessorKey: "currentUserRole",
      enableSorting: false,
      header: () => <CenteredHeader>Rol</CenteredHeader>,
      cell: ({ row }) => {
        const environment = row.original;
        const role =
          environment.currentUserRole ??
          (environment.ownerId === user?.id ? ENVIRONMENT_ROLE.OWNER : null);
        const label =
          role === ENVIRONMENT_ROLE.OWNER
            ? "Propietario"
            : role === ENVIRONMENT_ROLE.GUEST
              ? "Invitado"
              : "-";

        return <div className="text-center">{label}</div>;
      },
    },
    {
      accessorKey: "address",
      enableSorting: false,
      header: () => <CenteredHeader>Dirección</CenteredHeader>,
      cell: ({ row }) => (
        <div className="text-center max-w-[300px] mx-auto whitespace-normal break-words">
          {row.getValue("address")}
        </div>
      ),
    },
    {
      accessorKey: "location",
      enableSorting: false,
      header: () => <CenteredHeader>Ubicación</CenteredHeader>,
      cell: ({ row }) => {
        const location = row.getValue("location") as string;
        if (!location) return <div className="text-center">-</div>;
        return (
          <div className="flex justify-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${location}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center"
                  >
                    <MapPin className="size-4" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ver en el mapa</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        );
      },
    },
    {
      id: "status",
      accessorFn: (environment) => environment.isActive,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Estado" align="center" />
      ),
      cell: ({ row }) => {
        const isActive = row.original.isActive;
        return (
          <div className="flex justify-center">
            <Badge variant={isActive ? "default" : "destructive"}>
              {isActive ? "Activo" : "Inactivo"}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "actions",
      enableSorting: false,
      header: () => <CenteredHeader>Acciones</CenteredHeader>,
      cell: ({ row }) => {
        const environment = row.original;
        const canEdit = Boolean(
          environment.canEdit ?? isAdmin ?? environment.ownerId === user?.id,
        );
        const canDelete = Boolean(
          environment.canDelete ?? isAdmin ?? environment.ownerId === user?.id,
        );
        return (
          <div className="flex items-center justify-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => handleView(environment)}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ver detalles</p>
                </TooltipContent>
              </Tooltip>

              {canEdit ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleEdit(environment)}
                    >
                      <Edit className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Editar</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {canDelete && environment.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleDelete(environment.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Eliminar</p>
                  </TooltipContent>
                </Tooltip>
              ) : canDelete ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleReactivate(environment.id)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
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
  const currentSort = { sortBy, sortOrder } satisfies ServerSort<EnvironmentSortBy>;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data?.items || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      rowSelection,
      pagination: paginationState,
      sorting: toSortingState(currentSort),
    },
    onRowSelectionChange: setRowSelection,
    manualSorting: true,
    onSortingChange: (updater) => {
      const next = applySortingUpdate(
        updater,
        currentSort,
        Object.values(ENVIRONMENT_SORT_BY),
        { sortBy: DEFAULT_SORT_BY, sortOrder: DEFAULT_SORT_ORDER },
      );
      updateParams({ sortBy: next.sortBy, sortOrder: next.sortOrder });
    },
    manualPagination: true,
    pageCount: data?.pages || -1,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(paginationState) : updater;
      updateParams({
        page: (next.pageIndex + 1).toString(),
        size: next.pageSize.toString(),
      });
    },
  });

  if (isError) {
    return (
      <ListErrorState
        message="No se pudieron cargar los datos."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Filters section */}
      <div className="space-y-4">
        <div className="relative w-full" data-testid="environment-search-row">
            <Input
              placeholder="Buscar en todos los campos..."
              value={search}
              onChange={(e) =>
                updateParams({ search: e.target.value, page: "1" })
              }
              className="pr-8"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
                onClick={() => updateParams({ search: null })}
              >
                <X className="size-4" />
              </Button>
            )}
        </div>

        <div
          className="flex w-full flex-wrap items-center gap-2"
          data-testid="environment-actions-row"
        >
          <Button
            variant={
              accordionValue === "advance-filters" ? "secondary" : "default"
            }
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

          <div className="min-w-0">{actions}</div>
        </div>

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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Ordenar por</label>
                    <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                      <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Nombre</SelectItem>
                        <SelectItem value="type">Tipo</SelectItem>
                        <SelectItem value="owner">Dueño</SelectItem>
                        <SelectItem value="status">Estado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dirección</label>
                    <Select value={sortOrder} onValueChange={(value) => updateParams({ sortOrder: value })}>
                      <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascendente</SelectItem>
                        <SelectItem value="desc">Descendente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Status Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Estado</label>
                    <Select
                      value={statusFilter}
                      onValueChange={(val) => updateParams({ status: val })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Estado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="active">Activo</SelectItem>
                        <SelectItem value="inactive">Inactivo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Type Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tipo</label>
                    <Select
                      value={typeId || "all"}
                      onValueChange={(val) =>
                        updateParams({ typeId: val === "all" ? null : val })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {typesData?.items?.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Owner Filter */}
                  {isAdmin && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Dueño</label>
                      <Select
                        value={ownerId || "all"}
                        onValueChange={(val) =>
                          updateParams({ ownerId: val === "all" ? null : val })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Dueño" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          {usersData?.items?.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.firstName} {u.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Country Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">País</label>
                    <Select
                      value={countryId || "all"}
                      onValueChange={(val) =>
                        updateParams({
                          countryId: val === "all" ? null : val,
                          stateId: null,
                          cityId: null,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="País" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {countriesData?.items?.map(
                          (c: { id: string; name: string }) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Province (State) Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provincia</label>
                    <Select
                      value={stateId || "all"}
                      disabled={!countryId && !stateId}
                      onValueChange={(val) =>
                        updateParams({
                          stateId: val === "all" ? null : val,
                          cityId: null,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Provincia" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {statesData?.items?.map(
                          (s: { id: string; name: string }) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* City Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Ciudad</label>
                    <Select
                      value={cityId || "all"}
                      disabled={!stateId && !cityId}
                      onValueChange={(val) =>
                        updateParams({ cityId: val === "all" ? null : val })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Ciudad" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {citiesData?.items?.map(
                          (c: { id: string; name: string }) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="flex justify-end">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleExport("excel")}
          >
            <FileSpreadsheet className="size-4 text-green-600" />
            <span className="hidden sm:inline">Excel</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleExport("pdf")}
          >
            <FileText className="size-4 text-red-600" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </div>
      </div>

      <div className="hidden rounded-md border md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
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
                  No se encontraron resultados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 md:hidden" data-testid="environment-cards">
        {isLoading ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="sr-only">Cargando establecimientos</span>
          </div>
        ) : table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <EnvironmentMobileCard
              key={row.id}
              environment={row.original}
              currentUserId={user?.id}
              isAdmin={isAdmin}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onReactivate={handleReactivate}
            />
          ))
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded-md border px-4 text-center text-sm">
            No se encontraron resultados.
          </div>
        )}
      </div>

      {/* Pagination */}
      <DataTablePagination
        table={table}
        totalItems={data?.total || 0}
        entityName="registros"
      />

      <EnvironmentDetailDialog
        environment={selectedEnvironment}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
