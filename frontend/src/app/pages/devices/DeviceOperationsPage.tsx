import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type PaginationState,
  type Row,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { addDays } from "date-fns";
import { formatDateTime } from "@/utils/date.utils";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableColumnHeader } from "@/components/custom/DataTableColumnHeader";
import { DataTablePagination } from "@/components/custom/DataTablePagination";
import { ListErrorState } from "@/components/custom/ListErrorState";
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
import { deviceService } from "@/app/services/device.service";
import type { DeviceOperation } from "@/app/types/device.types";
import { toPositiveInt } from "@/utils/url-params";

function OperationCard({ row }: { row: Row<DeviceOperation> }) {
  const operation = row.original;
  const formattedDateTime = formatDateTime(operation.time);

  return (
    <Card
      role="article"
      aria-label={`${formattedDateTime}, ${operation.operation_type}, ${operation.status}, operación ${operation.id}`}
      className="gap-4 py-4"
    >
      <CardHeader>
        <CardTitle>{formattedDateTime}</CardTitle>
        <CardDescription className="flex flex-wrap gap-2">
          <span className="sr-only">Estado</span>
          <Badge variant="outline">{operation.status}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>{operation.operation_type}</dd>
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
  const backTo = (location.state as { from?: string })?.from || "/app/devices";
  const [searchParams, setSearchParams] = useSearchParams();

  // URL State
  const page = toPositiveInt(searchParams.get("page"), 1);
  const size = toPositiveInt(searchParams.get("size"), 20);
  const search = searchParams.get("search") || "";

  // Date State
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -7),
    to: new Date(),
  });

  // Fetch Device Info
  const {
    data: device,
    isLoading: isLoadingDevice,
    isError: isDeviceError,
    refetch: refetchDevice,
  } = useDevice(id || "");

  // Fetch Operations
  const {
    data: operationsData,
    isLoading: isLoadingOps,
    isError: isOperationsError,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [
      "device-operations",
      id,
      dateRange,
      page,
      size,
    ],
    queryFn: () =>
      deviceService.getOperations(device!.id, {
        page,
        perPage: size,
        startDate: dateRange?.from,
        endDate: dateRange?.to,
      }),
    enabled: !!device?.id && !!dateRange?.from,
  });

  useEffect(() => {
    if (
      !operationsData ||
      operationsData.total < 1 ||
      operationsData.pages < 1 ||
      page <= operationsData.pages
    ) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(operationsData.pages));
    setSearchParams(nextParams, { replace: true });
  }, [
    operationsData?.pages,
    operationsData?.total,
    page,
    searchParams,
    setSearchParams,
  ]);

  const [sorting, setSorting] = useState<SortingState>([]);

  // Handlers
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "" || value === "all") {
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

  const filteredOperations = useMemo(() => {
    const items = operationsData?.items || [];

    if (!search) {
      return items;
    }

    const searchLower = search.toLowerCase();
    return items.filter((operation) => {
      return (
        operation.id.toLowerCase().includes(searchLower) ||
        operation.operation_type.toLowerCase().includes(searchLower) ||
        operation.status.toLowerCase().includes(searchLower) ||
        formatDateTime(operation.time).toLowerCase().includes(searchLower)
      );
    });
  }, [operationsData?.items, search]);

  const columns = useMemo<ColumnDef<DeviceOperation>[]>(
    () => [
      {
        accessorKey: "time",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Fecha/Hora"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{formatDateTime(row.original.time)}</div>
        ),
      },
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="ID"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center font-mono text-xs font-medium">
            {row.original.id}
          </div>
        ),
      },
      {
        accessorKey: "operation_type",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Tipo"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center">{row.original.operation_type}</div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Estado"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Badge variant="outline">{row.original.status}</Badge>
          </div>
        ),
      },
    ],
    [],
  );

  const paginationState: PaginationState = useMemo(
    () => ({
      pageIndex: page - 1,
      pageSize: size,
    }),
    [page, size],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredOperations,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: (updater) => {
      if (typeof updater === "function") {
        setSorting(updater(sorting));
      } else {
        setSorting(updater);
      }
    },
    state: {
      sorting,
      pagination: paginationState,
    },
    manualSorting: false,
    manualPagination: true,
    pageCount: operationsData?.pages || 0,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(paginationState) : updater;

      updateParams({
        page: (next.pageIndex + 1).toString(),
        size: next.pageSize.toString(),
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
      <div className="space-y-4">
        <div className="flex gap-4">
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => navigate(backTo)}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Volver</span>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Error</h1>
            <p className="text-muted-foreground">Dispositivo no encontrado</p>
          </div>
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
      {/* Header */}
      <div className="flex gap-4 sm:flex-row">
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          onClick={() => navigate(backTo)}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Volver</span>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Operaciones: {device.name}
          </h2>
          <p className="text-muted-foreground">
            Historial de operaciones del dispositivo - ({device.serial})
          </p>
        </div>
      </div>

      {/* Filters Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Input
              placeholder="Buscar operaciones..."
              value={search}
              onChange={(e) =>
                updateParams({ search: e.target.value, page: "1" })
              }
              className="h-11 pr-12"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 size-11 -translate-y-1/2"
                onClick={() => updateParams({ search: null })}
              >
                <X className="size-4" />
                <span className="sr-only">Limpiar búsqueda</span>
              </Button>
            )}
          </div>

          {/* Date Range */}
          <DatePickerWithRange
            initialDateFrom={dateRange?.from}
            initialDateTo={dateRange?.to}
            onUpdate={(values) => setDateRange(values.range)}
            align="end"
            showCompare={false}
          />
        </div>
      </div>

      <div className="space-y-4">
        <section
          aria-label="Operaciones del dispositivo"
          className="grid gap-3 md:hidden"
        >
          {isLoadingOps ? (
            <div
              aria-label="Cargando operaciones"
              className="flex h-24 items-center justify-center"
            >
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
              {isLoadingOps ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : rows.length ? (
                rows.map((row) => (
                  <TableRow key={row.id}>
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
                    className="h-24 text-center text-muted-foreground"
                  >
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
    </div>
  );
}
