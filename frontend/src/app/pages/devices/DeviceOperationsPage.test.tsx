import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceOperation } from "@/app/types/device.types";
import DeviceOperationsPage from "./DeviceOperationsPage";

const refetchOperations = vi.fn();
const refetchDevice = vi.fn();
const getOperationsMock = vi.hoisted(() => vi.fn());
const exportOperationsMock = vi.hoisted(() => vi.fn());
const queryState: {
  data?: { items: DeviceOperation[]; pages: number; total: number };
  isLoading: boolean;
  isError?: boolean;
  refetch?: () => unknown;
} = { isLoading: false, isError: false, refetch: refetchOperations };
let queryOptions: { queryKey: unknown[]; queryFn: () => unknown };
const deviceState: {
  data?: { id: string; name: string; serial: string };
  isLoading: boolean;
  isError?: boolean;
  refetch?: () => unknown;
} = { isLoading: false, isError: false, refetch: refetchDevice };

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[]; queryFn: () => unknown }) => {
    queryOptions = options;
    return queryState;
  },
}));

vi.mock("@/app/services/device.service", () => ({
  deviceService: {
    getOperations: getOperationsMock,
    exportOperations: exportOperationsMock,
  },
}));

vi.mock("@/app/hooks/useDevices", () => ({
  useDevice: () => deviceState,
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) =>
    selector({ user: null }),
}));

vi.mock("@/components/ui/date-range-picker", () => ({
  DatePickerWithRange: ({
    onUpdate,
    initialDateFrom,
  }: {
    onUpdate: (value: { range: { from: Date; to: Date } }) => void;
    initialDateFrom?: Date;
  }) => (
    <button
      data-initial-from={initialDateFrom?.toISOString() ?? "none"}
      onClick={() =>
        onUpdate({
          range: {
            from: new Date(2026, 6, 1),
            to: new Date(2026, 6, 2),
          },
        })
      }
    >
      Rango de fechas
    </button>
  ),
}));

vi.mock("@/components/custom/DataTablePagination", () => ({
  DataTablePagination: ({ table }: { table: { nextPage: () => void } }) => (
    <nav aria-label="Paginación">
      <button onClick={() => table.nextPage()}>Página siguiente</button>
    </nav>
  ),
}));

const operations: DeviceOperation[] = [
  {
    id: "operation-later",
    time: "2026-07-24T15:30:00Z",
    operation_type: "SENSOR_DATA",
    status: "SUCCESS",
  },
  {
    id: "operation-earlier",
    time: "2026-07-23T12:15:00Z",
    operation_type: "KEEP_ACTIVE",
    status: "CONFIRMED",
  },
];

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Ubicación actual">
      {location.pathname}
      {location.search}
    </output>
  );
}

function HistoryBackProbe() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Volver en historial</button>;
}

function renderPage(
  initialEntry = "/app/devices/device-1/operations",
  state?: { from: string },
) {
  return render(
    <MemoryRouter
      initialEntries={[
        state
          ? {
              pathname: initialEntry.split("?")[0],
              search: initialEntry.includes("?")
                ? `?${initialEntry.split("?")[1]}`
                : "",
              state,
            }
          : initialEntry,
      ]}
    >
      <Routes>
        <Route
          path="/app/devices/:id/operations"
          element={
            <>
              <DeviceOperationsPage />
              <LocationProbe />
              <HistoryBackProbe />
            </>
          }
        />
        <Route path="/return" element={<div>Listado de dispositivos</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DeviceOperationsPage responsive presentation", () => {
  beforeEach(() => {
    deviceState.data = {
      id: "device-1",
      name: "Dispensador Norte",
      serial: "IOT-0001",
    };
    deviceState.isLoading = false;
    deviceState.isError = false;
    deviceState.refetch = refetchDevice;
    queryState.data = { items: operations, pages: 1, total: 2 };
    queryState.isLoading = false;
    queryState.isError = false;
    queryState.refetch = refetchOperations;
    refetchOperations.mockReset();
    refetchDevice.mockReset();
    getOperationsMock.mockReset();
    exportOperationsMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders generic operation cards in the final TanStack row order", () => {
    renderPage();

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("operation-later");
    expect(cards[1]).toHaveTextContent("operation-earlier");

    expect(within(cards[0]).getByText("Datos de sensores")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Exitoso")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/24\/07\/2026/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/12:30|15:30/)).toBeInTheDocument();
    expect(within(cards[1]).getByText("Dispositivo activo")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Confirmed")).toBeInTheDocument();
  });

  it("gives each mobile operation card a distinguishable accessible name", () => {
    renderPage();

    expect(
      screen.getByRole("article", {
        name: /24\/07\/2026.*Datos de sensores.*Exitoso.*operation-later/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", {
        name: /23\/07\/2026.*Dispositivo activo.*Confirmed.*operation-earlier/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps article names unique when visible operation values match", () => {
    queryState.data = {
      items: [
        { ...operations[0], id: "operation-duplicate-a" },
        { ...operations[0], id: "operation-duplicate-b" },
      ],
      pages: 1,
      total: 2,
    };

    renderPage();

    const firstArticle = screen.getByRole("article", {
      name: /Datos de sensores.*Exitoso.*operation-duplicate-a/,
    });
    const secondArticle = screen.getByRole("article", {
      name: /Datos de sensores.*Exitoso.*operation-duplicate-b/,
    });

    expect(firstArticle).toHaveAccessibleName();
    expect(secondArticle).toHaveAccessibleName();
    expect(firstArticle).not.toHaveAccessibleName(
      secondArticle.getAttribute("aria-label")!,
    );
  });

  it("keeps one mobile card region and the existing desktop table presentation", () => {
    renderPage();

    expect(screen.getByLabelText("Operaciones del dispositivo")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Paginación" })).toBeInTheDocument();
  });

  it("renders page-owned loading and empty states for mobile", () => {
    queryState.data = undefined;
    queryState.isLoading = true;
    const { rerender } = renderPage();

    expect(screen.getByLabelText("Cargando operaciones")).toBeInTheDocument();

    queryState.data = { items: [], pages: 0, total: 0 };
    queryState.isLoading = false;
    rerender(
      <MemoryRouter initialEntries={["/app/devices/device-1/operations"]}>
        <Routes>
          <Route
            path="/app/devices/:id/operations"
            element={<DeviceOperationsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("No se encontraron operaciones.")).toHaveLength(2);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("contains no financial cards, fields, currencies, or actions", () => {
    renderPage();

    const cards = screen.getAllByRole("article");
    expect(within(cards[0]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(cards[0]).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/pago|monto|moneda|proveedor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
  });

  it("sends URL-backed search, dates, sorting and pagination to the server", async () => {
    const user = userEvent.setup();
    queryState.data = { items: operations, pages: 2, total: 40 };
    renderPage("/app/devices/device-1/operations?search=SENSOR_DATA&page=1&size=20&startDate=2026-07-03&endDate=2026-07-04&sortBy=status&sortOrder=asc");

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText("Datos de sensores")).toHaveLength(2);
    expect(screen.getAllByText("Dispositivo activo")).toHaveLength(2);

    queryOptions.queryFn();
    expect(getOperationsMock).toHaveBeenCalledWith(
      "device-1",
      expect.objectContaining({
        page: 1,
        perPage: 20,
        search: "SENSOR_DATA",
        sortBy: "status",
        sortOrder: "asc",
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getByLabelText("Ubicación actual")).not.toHaveTextContent("search=");

    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    await user.click(screen.getByRole("button", { name: "Rango de fechas" }));
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("startDate=2026-07-01");
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("endDate=2026-07-02");

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("page=2");
  });

  it("resets active date filters and remounts the uncontrolled date picker", async () => {
    const user = userEvent.setup();
    renderPage("/app/devices/device-1/operations?startDate=2026-07-03&endDate=2026-07-04");

    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    let datePicker = screen.getByRole("button", { name: "Rango de fechas" });
    expect(datePicker).toHaveAttribute(
      "data-initial-from",
      new Date(2026, 6, 3).toISOString(),
    );
    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));
    datePicker = screen.getByRole("button", { name: "Rango de fechas" });
    expect(datePicker).toHaveAttribute("data-initial-from", "none");
    expect(screen.queryByRole("button", { name: "Limpiar todos" })).not.toBeInTheDocument();
  });

  it("exports all matching operations through the service", async () => {
    exportOperationsMock.mockResolvedValue(undefined);
    renderPage("/app/devices/device-1/operations?search=SUCCESS&sortBy=id&sortOrder=asc");

    await userEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(exportOperationsMock).toHaveBeenCalledWith(
      "device-1",
      "Dispensador Norte",
      "excel",
      expect.objectContaining({ search: "SUCCESS", sortBy: "id", sortOrder: "asc" }),
      expect.anything(),
    );
  });

  it("drives server sorting from sortable table headers", async () => {
    const user = userEvent.setup();
    renderPage("/app/devices/device-1/operations?page=3");

    await user.click(screen.getByRole("button", { name: "Estado" }));
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));

    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("page=1");
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("sortBy=status");
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("sortOrder=asc");
  });

  it("preserves the route-state back destination", async () => {
    const user = userEvent.setup();
    renderPage("/app/devices/device-1/operations", { from: "/return" });

    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByText("Listado de dispositivos")).toBeInTheDocument();
  });

  it("keeps missing-device navigation accessible", () => {
    deviceState.data = undefined;
    renderPage();

    expect(screen.getByText("Dispositivo no encontrado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("shows a retryable operations load error", async () => {
    queryState.data = undefined;
    queryState.isError = true;

    renderPage();

    expect(screen.getByText("No se pudieron cargar los datos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetchOperations).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable device load error", async () => {
    deviceState.data = undefined;
    deviceState.isError = true;

    renderPage();

    expect(screen.getByText("No se pudieron cargar los datos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetchDevice).toHaveBeenCalledTimes(1);
    expect(refetchOperations).not.toHaveBeenCalled();
  });

  it("uses valid request defaults for invalid page and size URL parameters", () => {
    renderPage("/app/devices/device-1/operations?page=abc&size=0");

    expect(queryOptions.queryKey).toEqual(expect.arrayContaining([
      "device-operations",
      "device-1",
      1,
      20,
    ]));
    queryOptions.queryFn();
    expect(getOperationsMock).toHaveBeenCalledWith(
      "device-1",
      expect.objectContaining({ page: 1, perPage: 20 }),
    );
  });

  it("replaces an out-of-range page when an empty current page still reports results", async () => {
    queryState.data = undefined;
    queryState.isLoading = true;
    const { rerender } = render(
      <MemoryRouter
        initialEntries={[
          "/previous",
          "/app/devices/device-1/operations?page=99&size=20",
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route
            path="/app/devices/:id/operations"
            element={
              <>
                <DeviceOperationsPage />
                <LocationProbe />
                <HistoryBackProbe />
              </>
            }
          />
          <Route path="/previous" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("page=99");

    queryState.data = { items: [], pages: 3, total: 42 };
    queryState.isLoading = false;
    rerender(
      <MemoryRouter
        initialEntries={[
          "/previous",
          "/app/devices/device-1/operations?page=99&size=20",
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route
            path="/app/devices/:id/operations"
            element={
              <>
                <DeviceOperationsPage />
                <LocationProbe />
                <HistoryBackProbe />
              </>
            }
          />
          <Route path="/previous" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("page=3"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Volver en historial" }));
    expect(screen.getByLabelText("Ubicación actual")).toHaveTextContent("/previous");
  });
});
