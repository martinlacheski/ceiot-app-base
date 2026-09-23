import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OverviewPage from "./OverviewPage";

const {
  deviceRefetch,
  environmentRefetch,
  useQueryMock,
} = vi.hoisted(() => ({
  deviceRefetch: vi.fn(),
  environmentRefetch: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useQuery: useQueryMock,
}));

type QueryState = {
  data?: unknown;
  isError?: boolean;
  isFetching?: boolean;
  isPending?: boolean;
  refetch?: ReturnType<typeof vi.fn>;
};

const environments = {
  items: [
    {
      id: "environment-1",
      name: "Establecimiento Norte",
      address: "Ruta 1",
      location: "",
      description: "",
      cityId: "city-1",
      typeId: "type-1",
      isActive: true,
    },
  ],
  total: 1,
  page: 1,
  size: 100,
  pages: 1,
};

const devices = {
  items: [
    {
      id: "device-online-disabled",
      serial: "SENSOR-001",
      name: "Sensor Norte",
      deviceTypeId: "type-1",
      status: "active",
      isActive: true,
      enabled: false,
      brokerConnected: true,
      environment: { id: "environment-1", name: "Establecimiento Norte" },
    },
    {
      id: "device-offline-enabled",
      serial: "SENSOR-002",
      name: "Sensor Sur",
      deviceTypeId: "type-1",
      status: "active",
      isActive: true,
      enabled: true,
      brokerConnected: false,
    },
    {
      id: "device-presence-unavailable",
      serial: "SENSOR-003",
      name: "Sensor Oeste",
      deviceTypeId: "type-1",
      status: "active",
      isActive: true,
      enabled: true,
      brokerConnected: null,
    },
  ],
  total: 3,
  page: 1,
  size: 100,
  pages: 1,
};

const state = (data: unknown, overrides: QueryState = {}) => ({
  data,
  isError: false,
  isFetching: false,
  isPending: false,
  refetch: vi.fn(),
  ...overrides,
});

const renderPage = () => render(
  <MemoryRouter>
    <OverviewPage />
  </MemoryRouter>,
);

describe("OverviewPage operational inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") {
        return state(environments, { refetch: environmentRefetch });
      }
      if (queryKey[0] === "devices") {
        return state(devices, { refetch: deviceRefetch });
      }
      return state({ items: [], totals: {} });
    });
  });

  it("uses only environment and device inventory queries", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Resumen operativo" })).toBeInTheDocument();
    const queryKeys = useQueryMock.mock.calls.map(([config]) => config.queryKey[0]);
    expect(queryKeys).toEqual(["environments", "devices"]);
    expect(queryKeys.some((key) => String(key).includes("revenue"))).toBe(false);
    expect(screen.queryByText(/ingresos|comisi[oó]n|transacciones|excel|pdf/i)).not.toBeInTheDocument();
  });

  it("reports connectivity from broker state independently from enabled state", () => {
    renderPage();

    const online = screen.getByTestId("device-device-online-disabled");
    expect(within(online).getByText("En línea")).toBeInTheDocument();
    expect(within(online).getByText("Deshabilitado")).toBeInTheDocument();

    const offline = screen.getByTestId("device-device-offline-enabled");
    expect(within(offline).getByText("Fuera de línea")).toBeInTheDocument();
    expect(within(offline).getByText("Habilitado")).toBeInTheDocument();

    const unavailable = screen.getByTestId("device-device-presence-unavailable");
    expect(within(unavailable).getByText("No disponible")).toBeInTheDocument();
    expect(within(unavailable).queryByText("Fuera de línea")).not.toBeInTheDocument();

    const onlineSummary = screen.getByText("Online mostrados").closest("div");
    const offlineSummary = screen.getByText("Offline mostrados").closest("div");
    expect(within(onlineSummary!).getByText("1")).toBeInTheDocument();
    expect(within(offlineSummary!).getByText("1")).toBeInTheDocument();
  });

  it("shows real inventory totals and honest navigation", () => {
    renderPage();

    expect(screen.getByTestId("environment-total")).toHaveTextContent("1");
    expect(screen.getByTestId("device-total")).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: "Ver establecimientos" })).toHaveAttribute(
      "href",
      "/app/environments",
    );
    expect(screen.getByRole("link", { name: "Ver dispositivos" })).toHaveAttribute(
      "href",
      "/app/devices",
    );
  });

  it("keeps loading and empty states separate without inventing inventory", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") return state(undefined, { isPending: true });
      return state({ ...devices, items: [], total: 0 });
    });

    renderPage();

    expect(screen.getByRole("status", { name: "Cargando establecimientos" })).toBeInTheDocument();
    expect(screen.getByText("No hay dispositivos disponibles.")).toBeInTheDocument();
    expect(screen.queryByTestId("environment-total")).not.toBeInTheDocument();
  });

  it("shows scoped errors and retries only the failed inventory", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") {
        return state(undefined, {
          isError: true,
          refetch: environmentRefetch,
        });
      }
      return state(devices, { refetch: deviceRefetch });
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar establecimientos" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar los establecimientos.",
    );
    expect(environmentRefetch).toHaveBeenCalledOnce();
    expect(deviceRefetch).not.toHaveBeenCalled();
  });
});
