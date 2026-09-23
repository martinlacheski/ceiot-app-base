import { BackButton } from "@/components/custom/BackButton";
import { useEffect, useMemo } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type PaginationState,
  type Row,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router";
import { Loader2 } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";

import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
import { ListSearchInput } from "@/components/custom/ListSearchInput";
import { ListExportActions } from "@/components/custom/ListExportActions";
import { getOperationStatusLabel, getOperationTypeLabel } from "@/utils/status-labels";
import {
  ListFiltersPanel,
  ListFiltersTrigger,
} from "@/components/custom/ListFiltersAccordion";
import { CENTERED_CELL_CLASS } from "@/components/custom/tableAlignment";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useDevice } from "@/app/hooks/useDevices";
import {
  deviceService,
  type DeviceOperationSortBy,
} from "@/app/services/device.service";
import type { DeviceOperation } from "@/app/types/device.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { useListFilters } from "@/hooks/useListFilters";
import { getExportGeneratedBy } from "@/utils/export-user.utils";
import { formatDateTime } from "@/utils/date.utils";
import { toPositiveInt } from "@/utils/url-params";
import { applySortingUpdate, toSortingState } from "@/lib/serverSorting";

const OPERATION_SORT_FIELDS: readonly DeviceOperationSortBy[] = [
  "time",
  "id",
  "operation_type",
  "status",
];
const DEFAULT_SORT = { sortBy: "time", sortOrder: "desc" } as const;

function parseSortBy(value: string | null): DeviceOperationSortBy {
  return OPERATION_SORT_FIELDS.includes(value as DeviceOperationSortBy)
    ? (value as DeviceOperationSortBy)
    : DEFAULT_SORT.sortBy;
}

function parseDate(value: string | null): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) ? date : undefined;
}

function OperationCard({ row }: { row: Row<DeviceOperation> }) {
  const operation = row.original;
  const formattedDateTime = formatDateTime(operation.time);

  return (
    <Card
      role="article"
      aria-label={`${formattedDateTime}, ${getOperationTypeLabel(operation.operation_type)}, ${getOperationStatusLabel(operation.status)}, operación ${operation.id}`}
      className="gap-4 py-4"
    >
      <CardHeader>
        <CardTitle>{formattedDateTime}</CardTitle>
        <CardDescription className="flex flex-wrap gap-2">
          <span className="sr-only">Estado</span>
          <Badge variant="outline">{getOperationStatusLabel(operation.status)}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>{getOperationTypeLabel(operation.operation_type)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">ID</dt>
            <dd className="break-all font-mono">{operation.id}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export default function DeviceOperationsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const defaultBackTo = location.pathname.startsWith("/admin/")
    ? "/admin/devices"
    : "/app/devices";
  const backTo = (location.state as { from?: string })?.from || defaultBackTo;
  const [searchParams, setSearchParams] = useSearchParams();
  const filtersPanel = useListFilters();
  const user = useAuthStore((state) => state.user);

  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 20);
  const search = searchParams.get("search") || "";
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const startDate = parseDate(startDateParam);
  const endDate = parseDate(endDateParam);
  const sortBy = parseSortBy(searchParams.get("sortBy"));
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const dateRangeKey = `${startDateParam || ""}:${endDateParam || ""}`;

  const {
    data: device,
    isLoading: isLoadingDevice,
    isError: isDeviceError,
    refetch: refetchDevice,
  } = useDevice(id || "");

  const {
    data: operationsData,
    isLoading: isLoadingOps,
    isError: isOperationsError,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [
      "device-operations",
      id,
      page,
      size,
      search,
      startDateParam,
      endDateParam,
      sortBy,
      sortOrder,
    ],
    queryFn: () =>
      deviceService.getOperations(device!.id, {
        page,
        perPage: size,
        search: search || undefined,
        startDate,
        endDate,
        sortBy,
        sortOrder,
      }),
    enabled: !!device?.id,
  });

  useEffect(() => {
    if (!operationsData || operationsData.total < 1 || page <= operationsData.pages) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("page", String(operationsData.pages));
    setSearchParams(next, { replace: true });
  }, [operationsData, page, searchParams, setSearchParams]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    });
    if (!("page" in updates)) next.set("page", "1");
    setSearchParams(next);
  };

  const hasActiveFilters =
    !!search ||
    !!startDate ||
    !!endDate ||
    sortBy !== DEFAULT_SORT.sortBy ||
    sortOrder !== DEFAULT_SORT.sortOrder;

  const resetAll = () => {
    const next = new URLSearchParams();
    next.set("page", "1");
    next.set("size", String(size));
    setSearchParams(next);
  };

  const handleDateUpdate = ({ range }: { range: DateRange }) => {
    updateParams({
      startDate: range.from ? format(range.from, "yyyy-MM-dd") : null,
      endDate: range.to ? format(range.to, "yyyy-MM-dd") : null,
      page: "1",
    });
  };

  const handleExport = async (exportFormat: "excel" | "pdf") => {
    if (!device) return;
    await deviceService.exportOperations(
      device.id,
      device.name,
      exportFormat,
      {
        page: 1,
        perPage: 10000,
        search: search || undefined,
        startDate,
        endDate,
        sortBy,
        sortOrder,
      },
      { generatedBy: getExportGeneratedBy(user) },
    );
  };

  const columns = useMemo<ColumnDef<DeviceOperation>[]>(
    () => [
      {
        accessorKey: "time",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fecha/Hora" align="center" />
        ),
        cell: ({ row }) => formatDateTime(row.original.time),
      },
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="ID" align="center" />
        ),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
      },
      {
        accessorKey: "operation_type",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tipo" align="center" />
        ),
        cell: ({ row }) => getOperationTypeLabel(row.original.operation_type),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" align="center" />
        ),
        cell: ({ row }) => <Badge variant="outline">{getOperationStatusLabel(row.original.status)}</Badge>,
      },
    ],
    [],
  );

  const paginationState: PaginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize: size }),
    [page, size],
  );

  const table = useReactTable({
    data: operationsData?.items || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      pagination: paginationState,
      sorting: toSortingState({ sortBy, sortOrder }),
    },
    manualPagination: true,
    manualSorting: true,
    pageCount: operationsData?.pages || 0,
    onSortingChange: (updater) => {
      const next = applySortingUpdate(
        updater,
        { sortBy, sortOrder },
        OPERATION_SORT_FIELDS,
        DEFAULT_SORT,
      );
      updateParams({
        page: "1",
        sortBy: next.sortBy,
        sortOrder: next.sortOrder,
      });
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(paginationState) : updater;
      updateParams({
        page: String(next.pageIndex + 1),
        size: String(next.pageSize),
      });
    },
  });
  const rows = table.getRowModel().rows;

  if (isLoadingDevice) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isDeviceError) {
    return (
      <ListErrorState
        message="No se pudieron cargar los datos."
        onRetry={() => void refetchDevice()}
      />
    );
  }

  if (!device) {
    return (
      <div className="flex gap-4">
        <BackButton onClick={() => navigate(backTo)} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Error</h1>
          <p className="text-muted-foreground">Dispositivo no encontrado</p>
        </div>
      </div>
    );
  }

  if (isOperationsError) {
    return (
      <ListErrorState
        message="No se pudieron cargar los datos."
        onRetry={() => void refetchOperations()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 sm:flex-row">
        <BackButton onClick={() => navigate(backTo)} />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Operaciones: {device.name}
          </h2>
          <p className="text-muted-foreground">
            Historial de operaciones del dispositivo - ({device.serial})
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <ListSearchInput
            value={search}
            onChange={(value) => updateParams({ search: value, page: "1" })}
            onClear={() => updateParams({ search: null, page: "1" })}
            className="w-full md:max-w-sm md:flex-1"
          />
          <ListFiltersTrigger
            open={filtersPanel.open}
            onOpenChange={filtersPanel.setOpen}
            hasActiveFilters={hasActiveFilters}
          />
        </div>
        <ListFiltersPanel
          open={filtersPanel.open}
          onOpenChange={filtersPanel.setOpen}
          hasActiveFilters={hasActiveFilters}
          onReset={resetAll}
        >
          <DatePickerWithRange
            key={dateRangeKey}
            initialDateFrom={startDate}
            initialDateTo={endDate}
            onUpdate={handleDateUpdate}
            align="start"
            showCompare={false}
            mobileLayout
            triggerClassName="w-full sm:w-auto"
          />
        </ListFiltersPanel>
      </div>

      <ListExportActions onExport={handleExport} disabled={isLoadingOps} />

      <section aria-label="Operaciones del dispositivo" className="grid gap-3 md:hidden">
        {isLoadingOps ? (
          <div aria-label="Cargando operaciones" className="flex h-24 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : rows.length ? (
          rows.map((row) => <OperationCard key={row.id} row={row} />)
        ) : (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            No se encontraron operaciones.
          </div>
        )}
      </section>

      <div className="hidden rounded-md border md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-center">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoadingOps ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={CENTERED_CELL_CLASS}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No se encontraron operaciones.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        totalItems={operationsData?.total || 0}
        entityName="operaciones"
      />
    </div>
  );
}
