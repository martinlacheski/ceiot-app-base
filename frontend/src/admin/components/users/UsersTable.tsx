import {
  flexRender,
  getCoreRowModel,
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
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { getUsersAction } from "@/admin/actions/user.actions";
import { useDeleteUser, useUpdateUser, useUsers } from "@/admin/hooks/useUsers";
import { useAuthStore } from "@/auth/store/auth.store";
import { exportToExcel, exportToPdf } from "@/lib/export.utils";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { getUserFullName } from "@/auth/actions/session-user";

import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListToolbarLayout } from "@/components/custom/ListToolbarLayout";
import {
  ListSortControls,
  type ListSortDirection,
} from "@/components/custom/ListSortControls";
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
  CardDescription,
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
import type { User } from "@/interfaces/user.interface";
import { showConfirmDialog } from "@/store/confirm.store";
import { toPositiveInt } from "@/utils/url-params";
import { useNavigate } from "react-router";
// import { UserDialog } from "./UserDialog";
import {
  UserLastAccessCell,
  UserLastAccessLines,
  getUserLastAccessExportValue,
} from "./UserLastAccess";
import { ViewUserDialog } from "./ViewUserDialog";

interface UsersTableProps {
  actions?: React.ReactNode;
}

const USER_SORT_OPTIONS = [
  { value: "username", label: "Usuario" },
  { value: "email", label: "Email" },
  { value: "firstName", label: "Nombre" },
  { value: "lastName", label: "Apellido" },
  { value: "identificationNumber", label: "DNI" },
  { value: "isActive", label: "Estado" },
  { value: "isAdmin", label: "Rol" },
  { value: "createdAt", label: "Fecha de alta" },
  { value: "lastSeenAt", label: "Último acceso" },
  { value: "lastLoginAt", label: "Último login" },
] as const;

type UserSortField = (typeof USER_SORT_OPTIONS)[number]["value"];

function parseUserSort(value: string | null): {
  field?: UserSortField;
  direction: ListSortDirection;
  isValid: boolean;
} {
  if (value === null) return { direction: "asc", isValid: true };

  const [field, direction, extra] = value.split(":");
  const isFieldAllowed = USER_SORT_OPTIONS.some((option) => option.value === field);
  if (extra || !isFieldAllowed || (direction !== "asc" && direction !== "desc")) {
    return { direction: "asc", isValid: false };
  }

  return {
    field: field as UserSortField,
    direction,
    isValid: true,
  };
}

interface UserMobileCardProps {
  user: User;
  onView: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (id: string) => void;
  onActivate: (id: string) => void;
}

export function UserMobileCard({
  user,
  onView,
  onEdit,
  onDelete,
  onActivate,
}: UserMobileCardProps) {
  const fullName = getUserFullName(user).trim() || user.username;

  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden py-4"
      data-testid="user-mobile-card"
    >
      <CardHeader className="min-w-0 gap-1 px-4">
        <CardTitle className="min-w-0 truncate pr-2">{fullName}</CardTitle>
        <CardDescription className="min-w-0 truncate">
          @{user.username}
        </CardDescription>
        <CardAction>
          <Badge variant={user.isActive ? "default" : "secondary"}>
            {user.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 px-4">
        <p className="min-w-0 break-words text-sm text-muted-foreground">
          {user.email}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={user.isAdmin ? "destructive" : "outline"}>
            {user.isAdmin ? "Admin" : "Usuario"}
          </Badge>
          {user.identificationNumber && (
            <span className="min-w-0 break-words text-sm text-muted-foreground">
              DNI {user.identificationNumber}
            </span>
          )}
        </div>
        <UserLastAccessLines user={user} />
      </CardContent>
      <CardFooter className="flex min-w-0 gap-2 px-4">
        <Button
          className="min-h-11 min-w-0 flex-1"
          onClick={() => onView(user)}
        >
          <Eye data-icon="inline-start" />
          Ver detalles
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label={`Más acciones para ${user.username}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onEdit(user)}
              >
                <Pencil />
                Editar
              </DropdownMenuItem>
              {user.isActive ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onSelect={() => onDelete(user.id)}
                >
                  <Trash2 />
                  Eliminar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => onActivate(user.id)}
                >
                  <RotateCw />
                  Habilitar usuario
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export function UsersTable({ actions }: UsersTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuthStore();

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") ?? "";
  // Check if isActive is present. If not, default to "active". If present, check value.
  const rawIsActive = searchParams.get("isActive");
  const isActiveParam = rawIsActive === null ? "active" : rawIsActive;
  const isAdminParam = searchParams.get("isAdmin");
  const parsedSort = parseUserSort(searchParams.get("sort"));
  const sortField = parsedSort.field;
  const sortDirection = parsedSort.direction;
  const sorting: SortingState = sortField
    ? [{ id: sortField, desc: sortDirection === "desc" }]
    : [];

  // Local UI State
  const navigate = useNavigate();
  // const [isCreateOpen, setIsCreateOpen] = useState(false);
  // const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [accordionValue, setAccordionValue] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (parsedSort.isValid) return;

    const newParams = new URLSearchParams(searchParams);
    newParams.delete("sort");
    newParams.set("page", "1");
    setSearchParams(newParams, { replace: true });
  }, [parsedSort.isValid, searchParams, setSearchParams]);

  // Data Fetching
  const {
    data: usersResponse,
    isLoading,
    isError,
    refetch,
  } = useUsers({
    page,
    size,
    search,
    isActive:
      isActiveParam === "active"
        ? true
        : isActiveParam === "inactive"
          ? false
          : undefined,
    isAdmin:
      isAdminParam === "admin"
        ? true
        : isAdminParam === "user"
          ? false
          : undefined,
    sort: sortField ? `${sortField}:${sortDirection}` : undefined,
  });

  useEffect(() => {
    const lastPage = usersResponse?.pages;
    const total = usersResponse?.total;
    if (!total || total <= 0 || !lastPage || lastPage <= 0 || page <= lastPage)
      return;

    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", lastPage.toString());
    setSearchParams(newParams, { replace: true });
  }, [page, searchParams, setSearchParams, usersResponse]);

  // Export Handler
  const handleExport = async (format: "pdf" | "excel") => {
    try {
      setIsExporting(true);
      const toastId = toast.loading("Generando reporte...");

      // Fetch all data for export (using a large page size)
      const response = await getUsersAction({
        page: 1,
        size: 10000, // Fetch up to 10000 records
        search,
        isActive:
          isActiveParam === "active"
            ? true
            : isActiveParam === "inactive"
              ? false
              : undefined,
        isAdmin:
          isAdminParam === "admin"
            ? true
            : isAdminParam === "user"
              ? false
              : undefined,
        sort: sortField ? `${sortField}:${sortDirection}` : undefined,
      });

      const users = response.items;
      const exportOptions = {
        title: "Reporte de Usuarios",
        filename: "reporte_usuarios",
        generatedBy: getExportGeneratedBy(currentUser),
        columns: [
          "Usuario",
          "Email",
          "Nombre",
          "Apellido",
          "Estado",
          "Rol",
          "Último acceso",
        ],
        data: users.map((u) => [
          u.username,
          u.email,
          u.firstName || "",
          u.lastName || "",
          u.isActive ? "Activo" : "Inactivo",
          u.isAdmin ? "Admin" : "Usuario",
          getUserLastAccessExportValue(u),
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

  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();

  const handleDelete = (id: string) => {
    showConfirmDialog("¿Estás seguro de eliminar este usuario?", () => {
      deleteUser.mutate(id);
    });
  };

  const handleActivate = (id: string) => {
    showConfirmDialog("¿Estás seguro de habilitar este usuario?", () => {
      updateUser.mutate({ id, user: { isActive: true } });
    });
  };

  const handleView = (user: User) => {
    setSelectedUser(user);
    setIsViewOpen(true);
  };

  const handleEdit = (user: User) => {
    navigate(`/admin/users/edit/${user.id}`);
  };

  // URL Updates helpers
  const updateSearchParam = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.set("page", "1"); // Reset to first page on filter change
    setSearchParams(newParams);
  };

  const updateSort = (field?: UserSortField, direction = sortDirection) => {
    updateSearchParam("sort", field ? `${field}:${direction}` : null);
  };

  const handleSortingChange = (updater: Updater<SortingState>) => {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    const nextSort = nextSorting[0];
    updateSort(
      nextSort?.id as UserSortField | undefined,
      nextSort?.desc ? "desc" : "asc",
    );
  };

  // Badge should only show if filters differ from default (active)
  const hasActiveFilters =
    !!search || isActiveParam !== "active" || !!isAdminParam || !!sortField;

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("search");
    newParams.delete("isAdmin");
    newParams.delete("sort");
    newParams.set("isActive", "active");
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "username",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Usuario"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="font-medium text-center">
          {row.getValue("username")}
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Email"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.getValue("email")}</div>
      ),
    },
    {
      accessorKey: "firstName",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Nombre"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.getValue("firstName")}</div>
      ),
    },
    {
      accessorKey: "lastName",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Apellido"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.getValue("lastName")}</div>
      ),
    },
    {
      accessorKey: "identificationNumber",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="DNI"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">
          {row.getValue("identificationNumber")}
        </div>
      ),
    },
    {
      accessorKey: "isActive",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Estado"
          className="justify-center"
        />
      ),
      cell: ({ row }) => {
        const isActive = row.getValue("isActive") as boolean;
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
      accessorKey: "isAdmin",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Rol"
          className="justify-center"
        />
      ),
      cell: ({ row }) => {
        const isAdmin = row.getValue("isAdmin") as boolean;
        return (
          <div className="flex justify-center">
            <Badge variant={isAdmin ? "destructive" : "outline"}>
              {isAdmin ? "Admin" : "Usuario"}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "lastSeenAt",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Último acceso"
          className="justify-center"
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">
          <UserLastAccessCell user={row.original} />
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-center">Acciones</div>,
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center justify-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => handleView(user)}
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
                    onClick={() => handleEdit(user)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Editar</p>
                </TooltipContent>
              </Tooltip>

              {user.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleDelete(user.id)}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActivate(user.id);
                      }}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Habilitar usuario</p>
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

    // Update URL parameters
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", (nextPagination.pageIndex + 1).toString());
    newParams.set("size", nextPagination.pageSize.toString());
    setSearchParams(newParams);
  };

  const table = useReactTable({
    data: usersResponse?.items ?? [],
    columns,
    pageCount: usersResponse?.pages ?? -1,
    state: {
      pagination: paginationState,
      sorting,
    },
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true, // The API sorts the full result set before pagination.
    enableMultiSort: false,
  });

  if (isError) {
    return (
      <ListErrorState message="Error al cargar usuarios" onRetry={refetch} />
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Filters section (unchanged) */}
      <div className="space-y-4">
        {/* ... (keep input and accordion as is, removed duplicates) */}
        <ListToolbarLayout
          search={
            <div className="relative w-full min-w-0">
              <Input
                placeholder="Buscar en todos los campos..."
                value={search}
                onChange={(e) => updateSearchParam("search", e.target.value)}
                className="pr-11"
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
                  <X />
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
                    accordionValue === "advance-filters"
                      ? ""
                      : "advance-filters",
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
              {actions}
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
              <div
                className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
                data-testid="users-filter-panel"
              >
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
                <div
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
                  data-testid="users-filter-grid"
                >
                  <ListSortControls
                    options={USER_SORT_OPTIONS}
                    value={sortField}
                    direction={sortDirection}
                    onValueChange={(field) => updateSort(field)}
                    onDirectionChange={(direction) =>
                      updateSort(sortField, direction)
                    }
                  />
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Estado</label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={isActiveParam ?? "all"}
                      onChange={(e) =>
                        updateSearchParam(
                          "isActive",
                          e.target.value === "all" ? "all" : e.target.value,
                        )
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Rol</label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={isAdminParam ?? "all"}
                      onChange={(e) =>
                        updateSearchParam(
                          "isAdmin",
                          e.target.value === "all" ? null : e.target.value,
                        )
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="admin">Administrador</option>
                      <option value="user">Usuario</option>
                    </select>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
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
        className="grid grid-cols-1 gap-3 md:hidden"
        data-testid="users-mobile-list"
      >
        {isLoading ? (
          Array.from({ length: 3 }, (_, index) => (
            <Card
              key={index}
              className="gap-4 py-4"
              data-testid="user-mobile-skeleton"
            >
              <CardHeader className="gap-2 px-4">
                <CardTitle>
                  <Skeleton className="h-5 w-2/3" />
                </CardTitle>
                <CardDescription>
                  <Skeleton className="h-4 w-1/3" />
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-5 w-1/2" />
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
              <UserMobileCard
                key={row.id}
                user={row.original}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onActivate={handleActivate}
              />
            ))
        ) : (
          <div className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
            No hay resultados.
          </div>
        )}
      </div>
      <div
        className="hidden rounded-md border md:block"
        data-testid="users-desktop-table"
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
                  Cargando...
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
          totalItems={usersResponse?.total}
          entityName="registros"
        />
      </div>

      {selectedUser && (
        <>
          <ViewUserDialog
            open={isViewOpen}
            onOpenChange={setIsViewOpen}
            user={selectedUser}
          />
        </>
      )}
    </div>
  );
}
