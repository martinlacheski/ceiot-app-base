import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OverviewPage from "./OverviewPage";

const {
  auth,
  deviceRefetch,
  environmentRefetch,
  telemetry,
  useQueriesMock,
  useQueryMock,
} = vi.hoisted(() => ({
  auth: { user: { id: "user-1", isAdmin: false, permissions: ["telemetry:read"] } as unknown },
  deviceRefetch: vi.fn(),
  environmentRefetch: vi.fn(),
  telemetry: {
    latest: undefined as unknown,
    history: undefined as unknown,
    historyByDevice: {} as Record<string, unknown>,
  },
  useQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useQueries: useQueriesMock,
  useQuery: useQueryMock,
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({ user: auth.user }),
}));

vi.mock("@/components/dashboard/charts/EnvironmentalReadingsChart", () => ({
  EnvironmentalReadingsChart: ({ variableCode, sensors }: { variableCode: string; sensors: unknown[] }) => (
    <div data-testid={`chart-${variableCode}`}>{sensors.length} series</div>
  ),
}));

vi.mock("./overview/EnvironmentReadingsChart", () => ({
  EnvironmentReadingsChart: ({ variable, series }: { variable: { code: string }; series: Array<{ key: string; label: string }> }) => (
    <ul data-testid="environment-chart" data-variable={variable.code}>
      {series.map((entry) => <li key={entry.key}>{entry.label}</li>)}
    </ul>
  ),
}));

type QueryState = {
  data?: unknown;
  isError?: boolean;
  isFetching?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  refetch?: ReturnType<typeof vi.fn>;
};

type QueryConfig = {
  queryKey: unknown[];
  enabled?: boolean;
  queryFn: () => unknown;
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
      id: "device-offline-enabled",
      serial: "SENSOR-002",
      name: "Sensor Sur",
      deviceTypeId: "type-1",
      status: "active",
      isActive: true,
      enabled: true,
      brokerConnected: false,
      lastConnection: "2025-01-01T10:00:00Z",
    },
    {
      id: "device-online",
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

const sensors = [
  {
    key: "dht22",
    sensorCode: "dht22",
    sensorName: "DHT22",
    variables: [
      { code: "temperature", name: "Temperatura", unit: "°C" },
      { code: "relative_humidity", name: "Humedad", unit: "%" },
    ],
  },
];

const readings = {
  items: [
    { time: "2026-10-10T12:30:00Z", values: { dht22: { temperature: 23.4, relative_humidity: 51.25 } } },
    { time: "2026-10-10T12:29:00Z", values: { dht22: { temperature: 23.1, relative_humidity: null } } },
  ],
  total: 2,
  sensors,
};

const state = (data: unknown, overrides: QueryState = {}) => ({
  data,
  isError: false,
  isFetching: false,
  isLoading: false,
  isPending: false,
  refetch: vi.fn(),
  ...overrides,
});

const renderPage = () => render(
  <MemoryRouter>
    <OverviewPage />
  </MemoryRouter>,
);

const queryConfigs = () => useQueryMock.mock.calls.map(([config]) => config as QueryConfig);
const lastTelemetryQuery = (kind: "latest" | "history") =>
  queryConfigs().filter((config) => config.queryKey[0] === "telemetry" && config.queryKey[1] === kind).at(-1)!;
const lastEnvironmentQueries = () =>
  (useQueriesMock.mock.calls.at(-1)![0] as { queries: Array<QueryConfig & { refetchInterval?: number }> }).queries;

/** Two devices in "Establecimiento Norte", one in "Establecimiento Sur", one unassigned. */
const establishmentDevices = {
  ...devices,
  items: [
    { ...devices.items[0], environment: { id: "environment-1", name: "Establecimiento Norte" } },
    devices.items[1],
    { ...devices.items[2], environment: { id: "environment-2", name: "Establecimiento Sur" } },
    { ...devices.items[2], id: "device-unassigned", serial: "SENSOR-004", name: "Sensor Libre" },
  ],
  total: 4,
};

const useEstablishmentDevices = () => {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "environments") return state(environments, { refetch: environmentRefetch });
    if (queryKey[0] === "devices") return state(establishmentDevices, { refetch: deviceRefetch });
    return queryKey[1] === "latest" ? telemetry.latest : telemetry.history;
  });
};

const openEstablishmentView = () => {
  fireEvent.click(screen.getByRole("button", { name: "Por establecimiento" }));
};

describe("OverviewPage operational dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: "user-1", isAdmin: false, permissions: ["telemetry:read"] };
    telemetry.latest = state(readings);
    telemetry.history = state(readings);
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
      if (queryKey[0] === "telemetry") {
        return queryKey[1] === "latest" ? telemetry.latest : telemetry.history;
      }
      return state(undefined);
    });
    telemetry.historyByDevice = {};
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) =>
      queries.map(({ queryKey }) => telemetry.historyByDevice[String(queryKey[2])] ?? telemetry.history));
  });

  it("keeps inventory queries and adds live-refreshable telemetry queries", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Resumen operativo" })).toBeInTheDocument();
    expect(screen.getByText("Estado de tu flota y últimas lecturas")).toBeInTheDocument();
    const keys = queryConfigs().map((config) => config.queryKey);
    expect(keys).toContainEqual(["environments", "operational-overview"]);
    expect(keys).toContainEqual(["devices", "operational-overview"]);
    expect(lastTelemetryQuery("latest").queryKey.slice(0, 3)).toEqual(["telemetry", "latest", "device-online"]);
    expect(lastTelemetryQuery("history").queryKey).toEqual(["telemetry", "history", "device-online", "24h"]);
    expect(keys.some((key) => String(key[0]).includes("revenue"))).toBe(false);
    expect(screen.queryByText(/ingresos|comisi[oó]n|transacciones|excel|pdf/i)).not.toBeInTheDocument();
  });

  it("shows fleet KPIs with totals and broker presence counts", () => {
    renderPage();

    expect(screen.getByTestId("kpi-environments")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-devices")).toHaveTextContent("3");
    expect(screen.getByTestId("kpi-online")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-offline")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-online-caption")).toHaveTextContent(/33\s*% de los mostrados/);
    expect(screen.getByTestId("kpi-offline-caption")).toHaveTextContent("1 sin dato");
    expect(screen.getByTestId("kpi-environments").closest("a")).toHaveAttribute("href", "/app/environments");
    expect(screen.getByTestId("kpi-devices").closest("a")).toHaveAttribute("href", "/app/devices");
    expect(screen.getByTestId("kpi-online").closest("a")).toHaveAttribute("href", "/app/devices");
  });

  it("lists device presence online first with links to every list", () => {
    renderPage();

    const fleet = screen.getByRole("region", { name: "Estado de dispositivos" });
    const rows = within(fleet).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "device-device-online",
      "device-device-offline-enabled",
      "device-device-presence-unavailable",
    ]);
    expect(within(rows[0]).getByText("En línea")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Fuera de línea")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/^hace /)).toBeInTheDocument();
    expect(within(rows[2]).getByText("No disponible")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos los dispositivos" })).toHaveAttribute("href", "/app/devices");
    expect(screen.getByRole("link", { name: "Ver todos los establecimientos" })).toHaveAttribute(
      "href",
      "/app/environments",
    );
  });

  it("selects the first online device by default and lets the user switch device", () => {
    renderPage();

    const select = screen.getByLabelText("Dispositivo") as HTMLSelectElement;
    expect(select.value).toBe("device-online");
    expect(screen.getByRole("link", { name: "Ver detalle" })).toHaveAttribute("href", "/app/devices/device-online");

    fireEvent.change(select, { target: { value: "device-offline-enabled" } });

    expect(lastTelemetryQuery("latest").queryKey.slice(0, 3)).toEqual(["telemetry", "latest", "device-offline-enabled"]);
    expect(lastTelemetryQuery("history").queryKey).toEqual(["telemetry", "history", "device-offline-enabled", "24h"]);
  });

  it("keeps the default device when its presence changes after a refresh", () => {
    const { rerender } = renderPage();
    expect((screen.getByLabelText("Dispositivo") as HTMLSelectElement).value).toBe("device-online");

    const refreshed = {
      ...devices,
      items: devices.items.map((device) => ({ ...device, brokerConnected: device.id === "device-offline-enabled" })),
    };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "devices") return state(refreshed, { refetch: deviceRefetch });
      if (queryKey[0] === "environments") return state(environments, { refetch: environmentRefetch });
      return queryKey[1] === "latest" ? telemetry.latest : telemetry.history;
    });
    rerender(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect((screen.getByLabelText("Dispositivo") as HTMLSelectElement).value).toBe("device-online");
    expect(lastTelemetryQuery("history").queryKey).toEqual(["telemetry", "history", "device-online", "24h"]);
  });

  it("changes the history period with the range presets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:30:00.000Z"));
    try {
      renderPage();
      expect(screen.getByRole("button", { name: "Últimas 24 horas" })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" }));
      expect(lastTelemetryQuery("history").queryKey).toEqual(["telemetry", "history", "device-online", "7d"]);

      fireEvent.click(screen.getByRole("button", { name: "Última hora" }));
      const history = lastTelemetryQuery("history");
      expect(history.queryKey).toEqual(["telemetry", "history", "device-online", "1h"]);
      expect(screen.getByRole("button", { name: "Última hora" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders current values, charts and the latest records table", () => {
    renderPage();

    expect(screen.getByText(/23,4 °C/)).toBeInTheDocument();
    expect(screen.getByTestId("chart-temperature")).toHaveTextContent("1 series");

    const records = screen.getByRole("region", { name: "Últimos registros" });
    const table = within(records).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "DHT22 · Temperatura (°C)" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "DHT22 · Humedad (%)" })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("23,4")).toBeInTheDocument();
    expect(within(rows[0]).getByText("51,25")).toBeInTheDocument();
    expect(within(rows[1]).getByText("-")).toBeInTheDocument();
    expect(within(records).getByRole("link", { name: "Ver historial completo" })).toHaveAttribute(
      "href",
      "/app/devices/device-online",
    );
  });

  it("shows an empty records state when the device has no readings", () => {
    telemetry.latest = state({ items: [], total: 0, sensors: [] });
    telemetry.history = state({ items: [], total: 0, sensors: [] });

    renderPage();

    const records = screen.getByRole("region", { name: "Últimos registros" });
    expect(within(records).getByText("Aún no hay registros para este dispositivo.")).toBeInTheDocument();
    expect(within(records).queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not request telemetry without the telemetry permission", () => {
    auth.user = { id: "user-1", isAdmin: false, permissions: [] };

    renderPage();

    expect(screen.getByText("Tu usuario no tiene permiso para ver lecturas.")).toBeInTheDocument();
    expect(lastTelemetryQuery("latest").enabled).toBe(false);
    expect(lastTelemetryQuery("history").enabled).toBe(false);
    expect(screen.queryByRole("region", { name: "Últimos registros" })).not.toBeInTheDocument();
  });

  it("invites to pair a device when the fleet is empty", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") return state(environments);
      if (queryKey[0] === "devices") return state({ ...devices, items: [], total: 0 });
      return state(undefined);
    });

    renderPage();

    expect(screen.getByText("Todavía no hay dispositivos vinculados.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Asociar dispositivo" })).toHaveAttribute("href", "/app/devices/pair");
    expect(screen.getByText("No hay dispositivos disponibles.")).toBeInTheDocument();
    expect(lastTelemetryQuery("latest").enabled).toBe(false);
    expect(screen.getByTestId("kpi-online-caption")).toHaveTextContent("Sin dispositivos");
  });

  it("keeps loading states separate without inventing inventory", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") return state(undefined, { isPending: true });
      return state({ ...devices, items: [], total: 0 });
    });

    renderPage();

    expect(screen.getByRole("status", { name: "Cargando establecimientos" })).toBeInTheDocument();
    expect(screen.getByTestId("kpi-environments")).not.toHaveTextContent(/\d/);
    expect(screen.getByTestId("kpi-devices")).toHaveTextContent("0");
  });

  it("shows scoped errors and retries only the failed inventory", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") {
        return state(undefined, {
          isError: true,
          refetch: environmentRefetch,
        });
      }
      if (queryKey[0] === "devices") return state(devices, { refetch: deviceRefetch });
      return queryKey[1] === "latest" ? telemetry.latest : telemetry.history;
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar establecimientos" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar los establecimientos.",
    );
    expect(environmentRefetch).toHaveBeenCalledOnce();
    expect(deviceRefetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("kpi-devices")).toHaveTextContent("3");
  });
  it("keeps the per-device view by default without establishment queries enabled", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Por dispositivo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Por establecimiento" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Dispositivo")).toBeInTheDocument();
    expect(lastEnvironmentQueries().every((config) => config.enabled === false)).toBe(true);
  });

  it("switches to the establishment view and loads every device of the establishment", () => {
    useEstablishmentDevices();
    renderPage();

    openEstablishmentView();

    expect(screen.getByRole("button", { name: "Por establecimiento" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Dispositivo")).not.toBeInTheDocument();
    const select = screen.getByLabelText("Establecimiento") as HTMLSelectElement;
    expect(select.value).toBe("environment-1");
    expect(Array.from(select.options).map((option) => option.text)).toEqual([
      "Establecimiento Norte",
      "Establecimiento Sur",
    ]);
    const queries = lastEnvironmentQueries();
    expect(queries.map((config) => config.queryKey)).toEqual([
      ["telemetry", "history", "device-offline-enabled", "24h"],
      ["telemetry", "history", "device-online", "24h"],
    ]);
    expect(queries.every((config) => config.enabled === true && config.refetchInterval === 30_000)).toBe(true);
    expect(typeof queries[0].queryFn).toBe("function");

    const chart = screen.getByTestId("environment-chart");
    expect(chart).toHaveAttribute("data-variable", "temperature");
    expect(within(chart).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Sensor Sur · DHT22",
      "Sensor Norte · DHT22",
    ]);
    expect(screen.getByText("2 dispositivos · 2 sensores · promedio cada 10 minutos")).toBeInTheDocument();
  });

  it("loads the devices of the chosen establishment and shares the range presets", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    fireEvent.change(screen.getByLabelText("Establecimiento"), { target: { value: "environment-2" } });
    expect(lastEnvironmentQueries().map((config) => config.queryKey)).toEqual([
      ["telemetry", "history", "device-presence-unavailable", "24h"],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Última hora" }));
    expect(lastEnvironmentQueries().map((config) => config.queryKey)).toEqual([
      ["telemetry", "history", "device-presence-unavailable", "1h"],
    ]);
    expect(screen.getByText("1 dispositivo · 1 sensor · promedio cada 1 minuto")).toBeInTheDocument();
  });

  it("plots the variable picked in the variable chips", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    const temperature = screen.getByRole("button", { name: "Temperatura (°C)" });
    const humidity = screen.getByRole("button", { name: "Humedad (%)" });
    expect(temperature).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(humidity);

    expect(humidity).toHaveAttribute("aria-pressed", "true");
    expect(temperature).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-variable", "relative_humidity");
  });

  it("draws the devices that loaded and reports the ones that failed", () => {
    useEstablishmentDevices();
    telemetry.historyByDevice["device-online"] = state(undefined, { isError: true });
    renderPage();
    openEstablishmentView();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar las lecturas de 1 dispositivo(s)");
    const chart = screen.getByTestId("environment-chart");
    expect(within(chart).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Sensor Sur · DHT22"]);
  });

  it("shows loading and empty states for the establishment chart", () => {
    useEstablishmentDevices();
    telemetry.history = state(undefined, { isLoading: true, isPending: true });
    const { rerender } = renderPage();
    openEstablishmentView();

    expect(screen.getByRole("status", { name: "Cargando lecturas del establecimiento" })).toBeInTheDocument();

    telemetry.history = state({ items: [], total: 0, sensors });
    rerender(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
    expect(screen.getByText("No hay lecturas de este establecimiento en el período elegido.")).toBeInTheDocument();
  });

  it("does not request establishment telemetry without the telemetry permission", () => {
    auth.user = { id: "user-1", isAdmin: false, permissions: [] };
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    expect(screen.getByText("Tu usuario no tiene permiso para ver lecturas.")).toBeInTheDocument();
    expect(lastEnvironmentQueries()).toHaveLength(2);
    expect(lastEnvironmentQueries().every((config) => config.enabled === false)).toBe(true);
    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
  });
});
