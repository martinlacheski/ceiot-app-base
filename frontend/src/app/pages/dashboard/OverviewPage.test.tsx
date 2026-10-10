import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keepPreviousData } from "@tanstack/react-query";

import { useLivePulseStatus } from "@/app/live/livePulse.store";
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

vi.mock("./overview/EnvironmentReadingsChart", () => ({
  EnvironmentReadingsChart: ({ variable, series, hiddenKeys }: {
    variable: { code: string };
    series: Array<{ key: string; label: string }>;
    hiddenKeys?: ReadonlySet<string>;
  }) => (
    <ul data-testid="environment-chart" data-variable={variable.code}>
      {series.filter((entry) => !hiddenKeys?.has(entry.key)).map((entry) => <li key={entry.key}>{entry.label}</li>)}
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
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
  staleTime?: number;
  placeholderData?: unknown;
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
  (useQueriesMock.mock.calls.at(-1)![0] as { queries: QueryConfig[] }).queries;

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

const kpiTrigger = (testId: string) => screen.getByTestId(testId).closest("button")!;
/** Opens a KPI detail card the way a touch or keyboard user does (click/tap on the tile). */
const openKpi = (testId: string, dialogName: string) => {
  fireEvent.click(kpiTrigger(testId));
  return screen.getByRole("dialog", { name: dialogName });
};
const legendButton = (name: string) =>
  within(screen.getByRole("group", { name: "Series del gráfico" })).getByRole("button", { name });
const chartSeries = () =>
  within(screen.getByTestId("environment-chart")).queryAllByRole("listitem").map((item) => item.textContent);

describe("OverviewPage operational dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLivePulseStatus.getState().setConnected(true);
    auth.user = { id: "user-1", isAdmin: false, permissions: ["telemetry:read"] };
    telemetry.latest = state(readings);
    telemetry.history = state(readings);
    Element.prototype.scrollIntoView = vi.fn();
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

  describe("live updates without a visible refresh", () => {
    const dashboardQueries = () => [
      queryConfigs().filter((config) => config.queryKey[1] === "operational-overview").at(-1)!,
      lastTelemetryQuery("latest"),
      lastTelemetryQuery("history"),
    ];

    it("does not poll while the live pulse keeps the caches current", () => {
      renderPage();

      for (const config of [...dashboardQueries(), ...lastEnvironmentQueries()]) {
        expect(config.refetchInterval).toBe(false);
        expect(config.refetchOnWindowFocus).toBe(false);
        expect(config.staleTime).toBeGreaterThanOrEqual(60_000);
      }
    });

    it("falls back to slow polling only while the live pulse is disconnected", () => {
      useLivePulseStatus.getState().setConnected(false);
      renderPage();

      for (const config of [...dashboardQueries(), ...lastEnvironmentQueries()]) {
        expect(config.refetchInterval).toBe(60_000);
      }
    });

    it("keeps the previous readings on screen while another device or range loads", () => {
      renderPage();

      expect(lastTelemetryQuery("latest").placeholderData).toBe(keepPreviousData);
      expect(lastTelemetryQuery("history").placeholderData).toBe(keepPreviousData);
    });

    it("shows no refresh notice while data refetches in the background", () => {
      useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "environments") return state(environments, { isFetching: true });
        if (queryKey[0] === "devices") return state(devices, { isFetching: true });
        return state(readings, { isFetching: true });
      });

      renderPage();
      openKpi("kpi-devices", "Dispositivos");

      expect(screen.queryByText(/Actualizando/)).not.toBeInTheDocument();
      expect(screen.getByTestId("environment-chart")).toBeInTheDocument();
    });
  });

  it("shows fleet KPIs with totals and broker presence counts", () => {
    renderPage();

    expect(screen.getByTestId("kpi-environments")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-devices")).toHaveTextContent("3");
    expect(screen.getByTestId("kpi-online")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-offline")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-online-caption")).toHaveTextContent(/33\s*% de los mostrados/);
    expect(screen.getByTestId("kpi-offline-caption")).toHaveTextContent("1 sin dato");
    for (const testId of ["kpi-environments", "kpi-devices", "kpi-online", "kpi-offline"]) {
      expect(screen.getByTestId(testId).closest("a")).toBeNull();
      expect(kpiTrigger(testId)).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("drops the side column so the readings take the full width", () => {
    renderPage();

    expect(screen.queryByRole("region", { name: "Estado de dispositivos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Establecimientos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver todos los dispositivos" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Lecturas" })).toBeInTheDocument();
  });

  it("lists device presence online first in the devices KPI card with links to every list", () => {
    renderPage();

    const fleet = openKpi("kpi-devices", "Dispositivos");
    expect(kpiTrigger("kpi-devices")).toHaveAttribute("aria-expanded", "true");
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
    expect(within(rows[0]).getByText("Establecimiento Norte")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Sin establecimiento")).toBeInTheDocument();
    expect(within(fleet).getByRole("link", { name: "Ver todos los dispositivos" })).toHaveAttribute("href", "/app/devices");

    fireEvent.keyDown(fleet, { key: "Escape" });
    const places = openKpi("kpi-environments", "Establecimientos");
    expect(within(places).getByRole("link", { name: "Ver todos los establecimientos" })).toHaveAttribute(
      "href",
      "/app/environments",
    );
    expect(within(places).getByRole("button", { name: /Establecimiento Norte/ })).toHaveTextContent("1 dispositivo");
  });

  it("lists only the connected or disconnected devices in the presence KPI cards", () => {
    renderPage();

    const online = openKpi("kpi-online", "Dispositivos en línea");
    expect(within(online).getAllByRole("listitem").map((row) => row.getAttribute("data-testid"))).toEqual([
      "device-device-online",
    ]);
    fireEvent.keyDown(online, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const offline = openKpi("kpi-offline", "Dispositivos sin conexión");
    expect(within(offline).getAllByRole("listitem").map((row) => row.getAttribute("data-testid"))).toEqual([
      "device-device-offline-enabled",
    ]);
    expect(within(offline).getByText(/^hace /)).toBeInTheDocument();
  });

  it("opens the KPI card on hover and closes it when the pointer leaves", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.hover(kpiTrigger("kpi-online"));
    expect(await screen.findByRole("dialog", { name: "Dispositivos en línea" })).toBeInTheDocument();

    await user.unhover(kpiTrigger("kpi-online"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps a KPI card open when a hover-opened card is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.hover(kpiTrigger("kpi-online"));
    await screen.findByRole("dialog", { name: "Dispositivos en línea" });
    await user.click(kpiTrigger("kpi-online"));

    expect(screen.getByRole("dialog", { name: "Dispositivos en línea" })).toBeInTheDocument();
  });

  it("drives the readings to a device picked in a KPI card", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    const offline = openKpi("kpi-offline", "Dispositivos sin conexión");
    fireEvent.click(within(offline).getByRole("button", { name: /^Sensor Sur/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Por dispositivo" })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Dispositivo") as HTMLSelectElement).value).toBe("device-offline-enabled");
    expect(lastTelemetryQuery("latest").queryKey.slice(0, 3)).toEqual(["telemetry", "latest", "device-offline-enabled"]);
    expect(lastTelemetryQuery("history").queryKey).toEqual(["telemetry", "history", "device-offline-enabled", "24h"]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("drives the readings to an establishment picked in the establishments KPI card", () => {
    useEstablishmentDevices();
    const twoEnvironments = {
      ...environments,
      items: [...environments.items, { ...environments.items[0], id: "environment-2", name: "Establecimiento Sur" }],
      total: 2,
    };
    const base = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((config: { queryKey: string[] }) =>
      config.queryKey[0] === "environments" ? state(twoEnvironments, { refetch: environmentRefetch }) : base(config));
    renderPage();

    const places = openKpi("kpi-environments", "Establecimientos");
    expect(within(places).getByRole("button", { name: /Establecimiento Norte/ })).toHaveTextContent("2 dispositivos");
    fireEvent.click(within(places).getByRole("button", { name: /Establecimiento Sur/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Por establecimiento" })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Establecimiento") as HTMLSelectElement).value).toBe("environment-2");
    expect(lastEnvironmentQueries().map((config) => config.queryKey)).toEqual([
      ["telemetry", "history", "device-presence-unavailable", "24h"],
    ]);
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

  it("charts the selected device in a single chart with one series per sensor", () => {
    renderPage();

    const charts = screen.getAllByTestId("environment-chart");
    expect(charts).toHaveLength(1);
    expect(charts[0]).toHaveAttribute("data-variable", "temperature");
    expect(within(charts[0]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["DHT22"]);
    expect(screen.getByText("1 sensor · promedio cada 10 minutos")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Últimos registros" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Humedad (%)" }));

    expect(screen.getByRole("button", { name: "Humedad (%)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-variable", "relative_humidity");
  });

  it("shows the current values of the device in a compact strip", () => {
    renderPage();

    const strip = screen.getByRole("list", { name: "Valores actuales" });
    const items = within(strip).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Temperatura");
    expect(items[0]).toHaveTextContent("23,4 °C");
    expect(items[1]).toHaveTextContent("Humedad");
    expect(items[1]).toHaveTextContent("51,25 %");
    expect(screen.getByText(/^Última lectura hace /)).toBeInTheDocument();

    fireEvent.click(within(items[1]).getByRole("button"));

    expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-variable", "relative_humidity");
  });

  it("switches the device readings to the latest records table", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Gráfico" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tabla" }));

    expect(screen.getByRole("button", { name: "Tabla" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
    const readingsArea = screen.getByRole("region", { name: "Lecturas" });
    const table = within(readingsArea).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "DHT22 · Temperatura (°C)" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "DHT22 · Humedad (%)" })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("23,4")).toBeInTheDocument();
    expect(within(rows[0]).getByText("51,25")).toBeInTheDocument();
    expect(within(rows[1]).getByText("-")).toBeInTheDocument();
    expect(within(readingsArea).getByRole("link", { name: "Ver historial completo" })).toHaveAttribute(
      "href",
      "/app/devices/device-online",
    );
  });

  it("shows empty chart and records states when the device has no readings", () => {
    telemetry.latest = state({ items: [], total: 0, sensors: [] });
    telemetry.history = state({ items: [], total: 0, sensors: [] });

    renderPage();

    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
    expect(screen.getByText("No hay lecturas de este dispositivo en el período elegido.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabla" }));

    expect(screen.getByText("Aún no hay registros para este dispositivo.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not request telemetry without the telemetry permission", () => {
    auth.user = { id: "user-1", isAdmin: false, permissions: [] };

    renderPage();

    expect(screen.getByText("Tu usuario no tiene permiso para ver lecturas.")).toBeInTheDocument();
    expect(lastTelemetryQuery("latest").enabled).toBe(false);
    expect(lastTelemetryQuery("history").enabled).toBe(false);
    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Valores actuales" })).not.toBeInTheDocument();
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
    expect(within(openKpi("kpi-devices", "Dispositivos")).getByText("No hay dispositivos disponibles.")).toBeInTheDocument();
    expect(lastTelemetryQuery("latest").enabled).toBe(false);
    expect(screen.getByTestId("kpi-online-caption")).toHaveTextContent("Sin dispositivos");
  });

  it("keeps loading states separate without inventing inventory", () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "environments") return state(undefined, { isPending: true });
      return state({ ...devices, items: [], total: 0 });
    });

    renderPage();

    expect(kpiTrigger("kpi-environments")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("kpi-environments")).not.toHaveTextContent(/\d/);
    expect(within(openKpi("kpi-environments", "Establecimientos")).getByRole("status", { name: "Cargando establecimientos" }))
      .toBeInTheDocument();
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
    expect(queries.every((config) => config.enabled === true && config.refetchInterval === false)).toBe(true);
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

  it("switches the establishment readings to a table of merged buckets", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    fireEvent.click(screen.getByRole("button", { name: "Tabla" }));

    expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "Lecturas" })).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Hora",
      "Sensor Sur · DHT22 (°C)",
      "Sensor Norte · DHT22 (°C)",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByText("23,4")).toHaveLength(2);
    expect(within(rows[1]).getAllByText("23,1")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Humedad (%)" }));

    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Hora",
      "Sensor Sur · DHT22 (%)",
      "Sensor Norte · DHT22 (%)",
    ]);
    expect(within(screen.getByRole("table")).getAllByRole("row").slice(1)).toHaveLength(1);
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
  it("does not show a series legend for a single series", () => {
    renderPage();

    expect(screen.queryByRole("group", { name: "Series del gráfico" })).not.toBeInTheDocument();
  });

  it("hides and shows series from the legend and never hides the last one", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    const south = legendButton("Sensor Sur · DHT22");
    const north = legendButton("Sensor Norte · DHT22");
    expect(south).toHaveAttribute("aria-pressed", "true");
    expect(north).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Mostrar todos" })).not.toBeInTheDocument();

    fireEvent.click(south);

    expect(legendButton("Sensor Sur · DHT22")).toHaveAttribute("aria-pressed", "false");
    expect(chartSeries()).toEqual(["Sensor Norte · DHT22"]);
    expect(legendButton("Sensor Norte · DHT22")).toBeDisabled();

    fireEvent.click(legendButton("Sensor Norte · DHT22"));
    expect(chartSeries()).toEqual(["Sensor Norte · DHT22"]);

    fireEvent.click(screen.getByRole("button", { name: "Mostrar todos" }));

    expect(chartSeries()).toEqual(["Sensor Sur · DHT22", "Sensor Norte · DHT22"]);
    expect(legendButton("Sensor Norte · DHT22")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mostrar todos" })).not.toBeInTheDocument();
  });

  it("keeps hidden series hidden across data updates, variables and the table view", () => {
    useEstablishmentDevices();
    const { rerender } = renderPage();
    openEstablishmentView();
    fireEvent.click(legendButton("Sensor Sur · DHT22"));

    telemetry.history = state({ ...readings, items: [...readings.items] });
    rerender(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );
    expect(chartSeries()).toEqual(["Sensor Norte · DHT22"]);

    fireEvent.click(screen.getByRole("button", { name: "Humedad (%)" }));
    expect(chartSeries()).toEqual(["Sensor Norte · DHT22"]);
    expect(legendButton("Sensor Sur · DHT22")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Tabla" }));

    const table = within(screen.getByRole("region", { name: "Lecturas" })).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Hora",
      "Sensor Norte · DHT22 (%)",
    ]);
    expect(legendButton("Sensor Sur · DHT22")).toHaveAttribute("aria-pressed", "false");
  });
});
