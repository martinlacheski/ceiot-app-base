/* eslint-disable react-hooks/incompatible-library */
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getFilteredRowModel,
  type PaginationState,
} from "@tanstack/react-table";
import { formatDateTime, formatDate } from "@/utils/date.utils";
import { cn } from "@/lib/utils";
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
  FileText,
  RotateCw,
  Eye,
  Loader2,
  List,
  MapPin,
  MoreVertical,
} from "lucide-react";
import {
  DEVICE_SORT_BY,
  type Device,
  type DeviceSortBy,
  type DeviceSortOrder,
} from "@/app/types/device.types";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUsers } from "@/admin/hooks/useUsers";
import { useEnvironments } from "@/app/hooks/useEnvironments";

import { useState, useMemo, useCallback, useEffect } from "react";

import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { useNavigate, useSearchParams } from "react-router";
import { deviceService } from "@/app/services/device.service";
import {
  useDeleteDevice,
  useDevices,
  useDeviceManufactureDates,
  useDeviceTypes,
  useUpdateDevice,
} from "@/app/hooks/useDevices";

import { showConfirmDialog } from "@/store/confirm.store";
import { DeviceDetailDialog } from "./DeviceDetailDialog";
import { DevicePresenceBadge } from "./DevicePresenceBadge";
import { useAuthStore } from "@/auth/store/auth.store";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { toPositiveInt } from "@/utils/url-params";
import { resolveDeviceEditPath } from "./deviceEditPath";
import {
  buildDeviceMapSearchUrl,
  formatDeviceLocation,
  getDeviceLocationSourceLabel,
} from "./deviceMap";
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
import { applySortingUpdate, toSortingState } from "@/lib/serverSorting";
import { getDeviceStatusLabel } from "@/utils/status-labels";

const DEVICE_SORT_FIELDS = Object.values(DEVICE_SORT_BY) as DeviceSortBy[];
const DEVICE_SORT_FIELD_SET = new Set<string>(DEVICE_SORT_FIELDS);
const DEFAULT_SORT_BY: DeviceSortBy = DEVICE_SORT_BY.NAME;
const DEFAULT_SORT_ORDER: DeviceSortOrder = "asc";

function parseSortBy(value: string | null): DeviceSortBy {
  return value && DEVICE_SORT_FIELD_SET.has(value)
    ? (value as DeviceSortBy)
    : DEFAULT_SORT_BY;
}

function parseSortOrder(value: string | null): DeviceSortOrder {
  return value === "desc" || value === "asc" ? value : DEFAULT_SORT_ORDER;
}

function getDeviceStatusClasses(status: Device["status"]) {
  return cn(
    "border-transparent shadow",
    status === "new" && "bg-blue-500 text-white hover:bg-blue-500/80",
    status === "paired" && "bg-indigo-500 text-white hover:bg-indigo-500/80",
    status === "active" && "bg-green-500 text-white hover:bg-green-500/80",
    status === "maintenance" &&
      "bg-yellow-500 text-white hover:bg-yellow-500/80",
    status === "unpaired" && "bg-gray-500 text-white hover:bg-gray-500/80",
  );
}

interface DeviceMobileCardProps {
  device: Device;
  mode: "admin" | "user";
  currentUserId?: string;
  onView: (device: Device) => void;
  onEdit: (device: Device) => void;
  onOperations: (device: Device) => void;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
}

export function DeviceMobileCard({
  device,
  mode,
  currentUserId,
  onView,
  onEdit,
  onOperations,
  onDelete,
  onReactivate,
}: DeviceMobileCardProps) {
  const canEdit =
    mode === "admin" || device.environment?.ownerId === currentUserId;
  const canViewOperations = mode === "user";
  const canManageActivation = mode === "admin";
  const hasSecondaryActions =
    canEdit || canViewOperations || canManageActivation;

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="min-w-0 break-words pr-2 text-base">
          {device.name}
        </CardTitle>
        <CardAction>
          <Badge variant={device.isActive ? "default" : "destructive"}>
            {device.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </CardAction>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {device.serial}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        {device.environment?.name ? (
          <p>
            <span className="font-medium">Establecimiento:</span>{" "}
            {device.environment.name}
          </p>
        ) : null}
        {mode === "admin" && device.environment?.ownerName ? (
          <p>
            <span className="font-medium">Propietario:</span>{" "}
            {device.environment.ownerName}
          </p>
        ) : null}
        {device.type?.name ? (
          <p>
            <span className="font-medium">Tipo:</span> {device.type.name}
          </p>
        ) : null}
        {device.model ? (
          <p>
            <span className="font-medium">Modelo:</span> {device.model}
          </p>
        ) : null}
        {device.status !== "active" ? (
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={getDeviceStatusClasses(device.status)}
            >
              {getDeviceStatusLabel(device.status)}
            </Badge>
          </div>
        ) : null}
        <div
          className="flex w-full min-w-0 items-center justify-between gap-2"
          aria-label="Conectividad y última conexión"
        >
          <DevicePresenceBadge
            className="shrink-0"
            brokerConnected={device.brokerConnected}
          />
          <p className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
            Última conexión:{" "}
            {device.lastConnection
              ? formatDateTime(device.lastConnection)
              : "Sin registros"}
          </p>
        </div>
      </CardContent>
      <CardFooter className="gap-2 px-4">
        <Button
          className="min-h-11 flex-1"
          onClick={() => onView(device)}
        >
          <Eye />
          Ver detalle
        </Button>
        {hasSecondaryActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`Más acciones para ${device.name}`}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {canEdit ? (
                  <DropdownMenuItem className="min-h-11" onSelect={() => onEdit(device)}>
                    <Edit />
                    Editar
                  </DropdownMenuItem>
                ) : null}
                {canViewOperations ? (
                  <DropdownMenuItem className="min-h-11" onSelect={() => onOperations(device)}>
                    <List />
                    Operaciones
                  </DropdownMenuItem>
                ) : null}
                {canManageActivation && device.isActive ? (
                  <DropdownMenuItem
                    className="min-h-11"
                    variant="destructive"
                    onSelect={() => onDelete(device.id)}
                  >
                    <Trash2 />
                    Eliminar
                  </DropdownMenuItem>
                ) : canManageActivation ? (
                  <DropdownMenuItem className="min-h-11" onSelect={() => onReactivate(device.id)}>
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

interface DevicesTableProps {
  actions?: React.ReactNode;
  mode?: "admin" | "user";
}

export function DevicesTable({ actions, mode = "admin" }: DevicesTableProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { user } = useAuthStore();
  const isAdmin = mode === "admin";

  // Dialog State
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 10);
  const search = searchParams.get("search") || "";
  const environmentId = searchParams.get("environmentId") || undefined;
  const ownerId = searchParams.get("ownerId") || undefined;
  const deviceTypeId = searchParams.get("deviceTypeId") || undefined;
  const model = searchParams.get("model") || undefined;
  const batch = searchParams.get("batch") || undefined;
  const manufactureDate = searchParams.get("manufactureDate") || undefined;
  const status = searchParams.get("status") || undefined;
  const enabledParam = searchParams.get("enabled");
  const enabled =
    enabledParam === "true"
      ? true
      : enabledParam === "false"
        ? false
        : undefined;
  const sortBy = parseSortBy(searchParams.get("sortBy"));
  const sortOrder = parseSortOrder(searchParams.get("sortOrder"));

  // Local State
  const [rowSelection, setRowSelection] = useState({});
  const [accordionValue, setAccordionValue] = useState<string>("");

  const isActiveParam = searchParams.get("is_active") || "true";
  const isActive =
    isActiveParam === "true"
      ? true
      : isActiveParam === "false"
        ? false
        : undefined;

  // Queries
  const { data: usersData } = useUsers(
    {
      page: 1,
      size: 100,
      isActive: true,
    },
    { enabled: isAdmin },
  );

  const { data: environmentsData } = useEnvironments({
    page: 1,
    perPage: 100,
    isActive: true,
    sortBy: "name",
    sortOrder: "asc",
  });

  const { data: deviceTypesData } = useDeviceTypes();

  // Logic to determine owner filter options
  const ownerOptions = useMemo(() => {
    if (isAdmin && usersData?.items) {
      return usersData.items.map((u) => ({
        id: u.id,
        label: `${u.firstName} ${u.lastName}`,
      }));
    }
    if (!isAdmin && environmentsData?.items && user) {
      const owners = new Map<string, string>();
      environmentsData.items.forEach((env) => {
        if (env.ownerId && env.ownerName) {
          owners.set(
            env.ownerId,
            env.ownerId === user.id ? "Yo" : env.ownerName,
          );
        }
      });
      return Array.from(owners.entries()).map(([id, label]) => ({
        id,
        label,
      }));
    }
    return [];
  }, [isAdmin, usersData, environmentsData, user]);

  const { data, isLoading, isError, refetch } = useDevices(
    {
      page,
      perPage: size,
      search,
      environmentId,
      ownerId,
      deviceTypeId,
      model,
      batch,
      manufactureDate,
      status,
      enabled,
      isActive,
      sortBy,
      sortOrder,
    },
    { refetchInterval: 5000 },
  );

  useEffect(() => {
    if (!data || data.total < 1 || data.pages < 1 || page <= data.pages) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(data.pages));
    setSearchParams(nextParams, { replace: true });
  }, [data?.pages, data?.total, page, searchParams, setSearchParams]);

  // Mutations
  const deleteDevice = useDeleteDevice();

  // Export
  const handleExport = (format: "excel" | "pdf") =>
    deviceService.export(format, {
      page: 1,
      perPage: 1000,
      search,
      environmentId,
      ownerId,
      deviceTypeId,
      model,
      batch,
      manufactureDate,
      status,
      enabled,
      isActive,
      sortBy,
      sortOrder,
    }, {
      generatedBy: getExportGeneratedBy(user),
    });

  // Handlers
  const handleEdit = useCallback(
    (device: Device) => {
      navigate(resolveDeviceEditPath(mode, device.id));
    },
    [mode, navigate],
  );

  const handleView = useCallback((device: Device) => {
    setSelectedDevice(device);
    setDetailOpen(true);
  }, []);

  const { data: manufactureDates } = useDeviceManufactureDates();
  const updateDevice = useUpdateDevice();

  const handleReactivate = useCallback(
    (id: string) => {
      showConfirmDialog(
        "¿Estás seguro de habilitar este dispositivo?",
        async () => {
          await updateDevice.mutateAsync({
            id,
            data: { isActive: true },
          });
        },
      );
    },
    [updateDevice],
  );

  const handleDelete = useCallback(
    (id: string) => {
      showConfirmDialog(
        "¿Estás seguro de que deseas eliminar este dispositivo?",
        async () => {
          await deleteDevice.mutateAsync(id);
        },
      );
    },
    [deleteDevice],
  );

  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (key === "is_active" && value === "all") {
        newParams.set(key, String(value));
      } else if (value === null || value === "" || value === "all") {
        newParams.delete(key);
      } else {
        newParams.set(key, String(value));
      }
    });
    if (!updates.page) {
      newParams.set("page", "1");
    }
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams();
    // Reset to defaults
    newParams.set("size", String(size));
    newParams.set("page", "1");
    newParams.set("sortBy", DEFAULT_SORT_BY);
    newParams.set("sortOrder", DEFAULT_SORT_ORDER);
    setSearchParams(newParams);
  };

  const hasActiveFilters =
    !!search ||
    !!environmentId ||
    !!ownerId ||
    !!deviceTypeId ||
    !!model ||
    !!batch ||
    !!manufactureDate ||
    !!status ||
    enabled !== undefined ||
    isActive !== true ||
    sortBy !== DEFAULT_SORT_BY ||
    sortOrder !== DEFAULT_SORT_ORDER;

  // Columns
  const columns: ColumnDef<Device>[] = useMemo(() => {
    const locationColumn: ColumnDef<Device> = {
      id: "location",
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Ubicación"
          className="justify-center w-full flex"
        />
      ),
      cell: ({ row }) => {
        const location = formatDeviceLocation(row.original);
        const locationSource = getDeviceLocationSourceLabel(row.original);
        const mapUrl = buildDeviceMapSearchUrl(row.original);
        if (location === "-") return <div className="text-center">-</div>;

        const tooltipLabel = locationSource
          ? `${locationSource}: ${location}`
          : location;

        return (
          <div className="flex items-center justify-center text-center">
            {mapUrl ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center"
                    >
                      <MapPin className="size-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{tooltipLabel}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        );
      },
    };

    const commonColumns: ColumnDef<Device>[] = [
      {
        id: "actions",
        enableSorting: false,
        header: () => <div className="text-center">Acciones</div>,
        cell: ({ row }) => {
          const device = row.original;
          const isDeviceOwner = device.environment?.ownerId === user?.id;
          const canManageDevice = mode === "admin" || isDeviceOwner;
          return (
            <div className="flex items-center justify-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleView(device)}
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Ver detalles</p>
                  </TooltipContent>
                </Tooltip>

                {canManageDevice ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleEdit(device)}
                      >
                        <Edit className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Editar</p>
                    </TooltipContent>
                  </Tooltip>
                ) : null}

                {mode === "user" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() =>
                          navigate(`/app/devices/${device.id}/operations`, {
                            state: { from: "/app/devices" },
                          })
                        }
                      >
                        <List className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Ver operaciones</p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {mode === "admin" && (
                  <>
                    {device.isActive ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleDelete(device.id)}
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
                            onClick={() => handleReactivate(device.id)}
                          >
                            <RotateCw className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Habilitar</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )}
              </TooltipProvider>
            </div>
          );
        },
      },
    ];

    const adminSpecificColumns: ColumnDef<Device>[] = [
      {
        id: "info",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Info"
            className="w-full justify-center"
          />
        ),
        cell: ({ row }) => {
          const d = row.original;
          const env = d.environment;
          // Tooltip content: Name, Description, Environment, Owner
          return (
            <div className="flex justify-center">
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <FileText className="size-5 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent className="text-xs max-w-xs space-y-2 text-left p-3">
                    <div className="space-y-1">
                      <p>
                        <span className="font-semibold">Propietario:</span>{" "}
                        {env ? env.ownerName || "Desconocido" : "-"}
                      </p>
                      <p>
                        <span className="font-semibold">Establecimiento:</span>{" "}
                        {env ? env.name : "-"}
                      </p>
                      <p>
                        <span className="font-semibold">Dispositivo:</span>{" "}
                        {d.name}
                      </p>
                      <div>
                        <span className="font-semibold">Descripción:</span>{" "}
                        {d.description ? (
                          <span className="text-muted-foreground">
                            {d.description}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">
                            Sin descripción
                          </span>
                        )}
                      </div>
                      <p>
                        <span className="font-semibold">Última conexión:</span>{" "}
                        {d.lastConnection
                          ? formatDateTime(d.lastConnection)
                          : "Nunca"}
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        },
      },
      {
        id: DEVICE_SORT_BY.DEVICE_TYPE_NAME,
        accessorFn: (device) => device.type?.name,
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Tipo"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.original.type?.name || "-"}</div>
        ),
      },
      {
        accessorKey: "model",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Modelo"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.getValue("model") || "-"}</div>
        ),
      },
      {
        accessorKey: "batch",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Lote"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.getValue("batch") || "-"}</div>
        ),
      },
      {
        accessorKey: "manufactureDate",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Fecha Fabr."
            className="justify-center"
          />
        ),
        cell: ({ row }) => {
          const dateStr = row.getValue("manufactureDate") as string;
          return <div className="text-center">{formatDate(dateStr)}</div>;
        },
      },
      {
        accessorKey: "serial",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Número de Serie"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center font-mono text-xs">
            {row.getValue("serial")}
          </div>
        ),
      },
      locationColumn,
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Situación"
            className="justify-center"
          />
        ),
        cell: ({ row }) => {
          const status = (row.getValue("status") as string) || "new";

          return (
            <div className="flex justify-center">
              <Badge
                variant="outline"
                className={getDeviceStatusClasses(status as Device["status"])}
              >
                {getDeviceStatusLabel(status)}
              </Badge>
            </div>
          );
        },
      },
      {
        accessorKey: "enabled",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Habilitado"
            className="justify-center"
          />
        ),
        cell: ({ row }) => {
          const isEnabled = row.getValue("enabled") as boolean;
          return (
            <div className="flex justify-center">
              <Badge variant={isEnabled ? "default" : "secondary"}>
                {isEnabled ? "Sí" : "No"}
              </Badge>
            </div>
          );
        },
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
          const active = row.getValue("isActive") as boolean;
          return (
            <div className="flex justify-center">
              <Badge variant={active ? "default" : "secondary"}>
                {active ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          );
        },
      },
    ];

    const userColumns: ColumnDef<Device>[] = [
      {
        accessorKey: "serial",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Número de Serie"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center font-mono text-xs">
            {row.getValue("serial")}
          </div>
        ),
      },
      {
        id: "owner",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Propietario"
            className="w-full flex justify-center"
          />
        ),
        cell: ({ row }) => {
          const env = row.original.environment;
          if (!env) return <div className="text-center">-</div>;

          const isOwner = env.ownerId === user?.id;
          return (
            <div className="text-center">
              {isOwner ? "Yo" : env.ownerName || "Desconocido"}
            </div>
          );
        },
      },
      {
        id: "environmentName",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Establecimiento"
            className="w-full flex justify-center"
          />
        ),
        cell: ({ row }) => {
          const envName = row.original.environment?.name || "-";
          return <div className="text-center">{envName}</div>;
        },
      },
      {
        id: DEVICE_SORT_BY.DEVICE_TYPE_NAME,
        accessorFn: (device) => device.type?.name,
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Tipo"
            className="justify-center w-full flex"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.original.type?.name || "-"}</div>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Dispositivo"
            className="w-full justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center font-medium">{row.original.name}</div>
        ),
      },
      locationColumn,
      {
        id: "lastConnection",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Última Conexión"
            className="w-full flex justify-center"
          />
        ),
        cell: ({ row }) => {
          const last = row.original.lastConnection;
          return (
            <div className="text-center">
              {last ? formatDateTime(last) : "Nunca"}
            </div>
          );
        },
      },
    ];

    return mode === "admin"
      ? [...adminSpecificColumns, ...commonColumns]
      : [...userColumns, ...commonColumns];
  }, [
    mode,
    // isAdmin depends on mode, so it's covered
    handleEdit,
    handleDelete,
    handleReactivate,
    handleView,
    navigate,
    user?.id,
  ]);

  const paginationState: PaginationState = useMemo(
    () => ({
      pageIndex: page - 1,
      pageSize: size,
    }),
    [page, size],
  );

  const table = useReactTable({
    data: data?.items || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      rowSelection,
      pagination: paginationState,
      sorting: toSortingState({ sortBy, sortOrder }),
    },
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    manualSorting: true,
    onSortingChange: (updater) => {
      const next = applySortingUpdate(
        updater,
        { sortBy, sortOrder },
        DEVICE_SORT_FIELDS,
        { sortBy: DEFAULT_SORT_BY, sortOrder: DEFAULT_SORT_ORDER },
      );
      updateParams({
        page: "1",
        sortBy: next.sortBy,
        sortOrder: next.sortOrder,
      });
    },
    pageCount: data?.pages ?? -1,
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          {/* Search */}
          <ListSearchInput
            value={search}
            onChange={(value) => updateParams({ search: value, page: "1" })}
            onClear={() => updateParams({ search: null, page: "1" })}
            className="w-full md:max-w-sm md:flex-1"
          />

          <div className="flex flex-wrap items-center gap-2 md:flex-1">
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

            <div>{actions}</div>
          </div>
        </div>

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
                {/* Filter Grid */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {/* Owner Filter - Admin Only */}
                  {/* Owner Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Ordenar por</label>
                    <Select
                      value={sortBy}
                      onValueChange={(value) => updateParams({ sortBy: value })}
                    >
                      <SelectTrigger aria-label="Ordenar por" className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Nombre</SelectItem>
                        <SelectItem value="serial">Número de serie</SelectItem>
                        <SelectItem value="model">Modelo</SelectItem>
                        <SelectItem value="manufactureDate">Fecha de fabricación</SelectItem>
                        <SelectItem value="status">Situación</SelectItem>
                        <SelectItem value="enabled">Habilitado</SelectItem>
                        <SelectItem value="isActive">Estado</SelectItem>
                        <SelectItem value="lastConnection">Última conexión</SelectItem>
                        <SelectItem value="brokerConnected">Conectividad</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dirección</label>
                    <Select
                      value={sortOrder}
                      onValueChange={(value) => updateParams({ sortOrder: value })}
                    >
                      <SelectTrigger aria-label="Dirección" className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascendente</SelectItem>
                        <SelectItem value="desc">Descendente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dueño</label>
                    <Select
                      value={ownerId || "all"}
                      onValueChange={(val) =>
                        updateParams({ ownerId: val === "all" ? null : val })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {ownerOptions.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Environment Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Establecimiento
                    </label>
                    <Select
                      value={environmentId || "all"}
                      onValueChange={(val) =>
                        updateParams({
                          environmentId: val === "all" ? null : val,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {environmentsData?.items?.map((env) => (
                          <SelectItem key={env.id} value={env.id}>
                            {env.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tipo</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      value={deviceTypeId || "all"}
                      onChange={(e) =>
                        updateParams({ deviceTypeId: e.target.value })
                      }
                    >
                      <option value="all">Todos</option>
                      {deviceTypesData?.items?.map((deviceType) => (
                        <option key={deviceType.id} value={deviceType.id}>
                          {deviceType.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {mode === "admin" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Modelo</label>
                        <Input
                          placeholder="Filtrar por modelo..."
                          value={model || ""}
                          onChange={(e) =>
                            updateParams({ model: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Lote</label>
                        <Input
                          placeholder="Filtrar por lote..."
                          value={batch || ""}
                          onChange={(e) =>
                            updateParams({ batch: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Fecha de Fabricación
                        </label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={manufactureDate || "all"}
                          onChange={(e) =>
                            updateParams({
                              manufactureDate:
                                e.target.value === "all"
                                  ? null
                                  : e.target.value,
                            })
                          }
                        >
                          <option value="all">Todas</option>
                          {manufactureDates?.map((date) => (
                            <option key={date} value={date}>
                              {date}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Situación</label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={status || "all"}
                          onChange={(e) =>
                            updateParams({ status: e.target.value })
                          }
                        >
                          <option value="all">Todos</option>
                          <option value="new">{getDeviceStatusLabel("new")}</option>
                          <option value="paired">{getDeviceStatusLabel("paired")}</option>
                          <option value="active">{getDeviceStatusLabel("active")}</option>
                          <option value="maintenance">{getDeviceStatusLabel("maintenance")}</option>
                          <option value="unpaired">{getDeviceStatusLabel("unpaired")}</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Habilitado
                        </label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={enabledParam || "all"}
                          onChange={(e) =>
                            updateParams({ enabled: e.target.value })
                          }
                        >
                          <option value="all">Todos</option>
                          <option value="true">Si</option>
                          <option value="false">No</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Estado</label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={isActiveParam}
                          onChange={(e) =>
                            updateParams({ is_active: e.target.value })
                          }
                        >
                          <option value="all">Todos</option>
                          <option value="true">Activo</option>
                          <option value="false">Inactivo</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <ListExportActions onExport={handleExport} disabled={isLoading} />

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

      <div className="flex flex-col gap-3 md:hidden" data-testid="device-cards">
        {isLoading ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="sr-only">Cargando dispositivos</span>
          </div>
        ) : table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <DeviceMobileCard
              key={row.id}
              device={row.original}
              mode={mode}
              currentUserId={user?.id}
              onView={handleView}
              onEdit={handleEdit}
              onOperations={(device) =>
                navigate(`/app/devices/${device.id}/operations`, {
                  state: { from: "/app/devices" },
                })
              }
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

      <DataTablePagination
        table={table}
        totalItems={data?.total || 0}
        entityName="dispositivos"
      />

      <DeviceDetailDialog
        device={selectedDevice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
