import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keepPreviousData } from "@tanstack/react-query";

import { useLivePulseStatus } from "@/app/live/livePulse.store";
import OverviewPage from "./OverviewPage";

const {
  auth,
  clock,
  deviceRefetch,
  environmentRefetch,
  telemetry,
  useQueriesMock,
  useQueryMock,
} = vi.hoisted(() => ({
  auth: { user: { id: "user-1", isAdmin: false, permissions: ["telemetry:read"] } as unknown },
  clock: { now: 0 },
  deviceRefetch: vi.fn(),
  environmentRefetch: vi.fn(),
  telemetry: {
    latest: undefined as unknown,
    live: undefined as unknown,
    aggregate: undefined as unknown,
    aggregateByDevice: {} as Record<string, unknown>,
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

vi.mock("./overview/useNow", () => ({
  useNow: () => clock.now,
}));

const picker = vi.hoisted(() => ({ range: { from: new Date(), to: new Date() } as { from: Date; to?: Date } }));

vi.mock("@/components/ui/date-range-picker", () => ({
  DateRangePicker: ({ initialDateFrom, initialDateTo, onUpdate }: {
    initialDateFrom?: Date;
    initialDateTo?: Date;
    onUpdate: (values: { range: { from: Date; to?: Date } }) => void;
  }) => (
    <button
      type="button"
      data-from={initialDateFrom?.toDateString()}
      data-to={initialDateTo?.toDateString()}
      onClick={() => onUpdate({ range: picker.range })}
    >
      Elegir fechas
    </button>
  ),
}));

vi.mock("./overview/EnvironmentReadingsChart", () => ({
  EnvironmentReadingsChart: ({ variable, series, hiddenKeys, points, timeWindow, showBand }: {
    variable: { code: string };
    series: Array<{ key: string; label: string }>;
    hiddenKeys?: ReadonlySet<string>;
    points: Array<Record<string, unknown>>;
    timeWindow?: { start: number; end: number };
    showBand?: boolean;
  }) => (
    <ul
      data-testid="environment-chart"
      data-variable={variable.code}
      data-points={points.length}
      data-values={JSON.stringify(points.map((point) => point.s0 ?? null))}
      data-band={String(Boolean(showBand))}
      data-window-start={timeWindow?.start}
      data-window-end={timeWindow?.end}
    >
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

const stat = (avg: number, min = avg, max = avg, count = 1) => ({ avg, min, max, count });

/** One-minute buckets of the same readings, as the aggregate endpoint returns them (ascending). */
const aggregateReadings = {
  bucket: "1m",
  bucketSeconds: 60,
  start: "2026-10-09T12:31:00Z",
  end: "2026-10-10T12:31:00Z",
  items: [
    { time: "2026-10-10T12:29:00Z", values: { dht22: { temperature: stat(23.1, 22.9, 23.3, 3) } } },
    { time: "2026-10-10T12:30:00Z", values: { dht22: { temperature: stat(23.4, 23, 23.8, 4), relative_humidity: stat(51.25) } } },
  ],
  sensors,
};
const emptyAggregate = { ...aggregateReadings, items: [], sensors: [] };

/** Live state of the selected device: the newest fixture reading plus its health. */
const liveState = {
  source: "redis",
  time: readings.items[0].time,
  values: readings.items[0].values,
  health: { wifi_rssi: -55, firmware_version: "2.1.0" },
  presence: "online",
  sensors,
};

/** Telemetry query result by the kind in its key (`["telemetry", kind, ...]`). */
const telemetryState = (queryKey: unknown[]) => {
  if (queryKey[1] === "latest") return telemetry.latest;
  if (queryKey[1] === "live") return telemetry.live;
  if (queryKey[1] === "aggregate") return telemetry.aggregate;
  return undefined;
};

/** A minute after the newest fixture reading. */
const NOW = Date.parse("2026-10-10T12:31:00Z");
const HOUR = 60 * 60 * 1000;

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
const lastTelemetryQuery = (kind: "latest" | "live" | "aggregate") =>
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
    return telemetryState(queryKey);
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
    clock.now = NOW;
    useLivePulseStatus.getState().setConnected(true);
    auth.user = { id: "user-1", isAdmin: false, permissions: ["telemetry:read"] };
    telemetry.latest = state(readings);
    telemetry.live = state(liveState);
    telemetry.aggregate = state(aggregateReadings);
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
        return telemetryState(queryKey);
      }
      return state(undefined);
    });
    telemetry.aggregateByDevice = {};
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) =>
      queries.map(({ queryKey }) => telemetry.aggregateByDevice[String(queryKey[2])] ?? telemetry.aggregate));
  });

  it("keeps inventory queries and adds live-refreshable telemetry queries", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Resumen operativo" })).toBeInTheDocument();
    expect(screen.getByText("Estado de tu flota y últimas lecturas")).toBeInTheDocument();
    const keys = queryConfigs().map((config) => config.queryKey);
    expect(keys).toContainEqual(["environments", "operational-overview"]);
    expect(keys).toContainEqual(["devices", "operational-overview"]);
    expect(lastTelemetryQuery("latest").queryKey.slice(0, 3)).toEqual(["telemetry", "latest", "device-online"]);
    expect(lastTelemetryQuery("live").queryKey).toEqual(["telemetry", "live", "device-online"]);
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "24h", "now", "auto"]);
    expect(keys.some((key) => String(key[0]).includes("revenue"))).toBe(false);
    expect(screen.queryByText(/ingresos|comisi[oó]n|transacciones|excel|pdf/i)).not.toBeInTheDocument();
  });

  describe("live updates without a visible refresh", () => {
    const dashboardQueries = () => [
      queryConfigs().filter((config) => config.queryKey[1] === "operational-overview").at(-1)!,
      lastTelemetryQuery("latest"),
      lastTelemetryQuery("live"),
      lastTelemetryQuery("aggregate"),
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
      expect(lastTelemetryQuery("live").placeholderData).toBe(keepPreviousData);
      expect(lastTelemetryQuery("aggregate").placeholderData).toBe(keepPreviousData);
    });

    it("shows no refresh notice while data refetches in the background", () => {
      useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "environments") return state(environments, { isFetching: true });
        if (queryKey[0] === "devices") return state(devices, { isFetching: true });
        return { ...(telemetryState(queryKey) as object), isFetching: true };
      });

      renderPage();
      openKpi("kpi-devices", "Dispositivos");

      expect(screen.queryByText(/Actualizando/)).not.toBeInTheDocument();
      expect(screen.getByTestId("environment-chart")).toBeInTheDocument();
    });
  });

  describe("rolling window while a device stays quiet", () => {
    const rerenderPage = (rerender: (ui: ReactElement) => void) => rerender(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    it("spans the chart over the selected rolling window", () => {
      renderPage();

      const chart = screen.getByTestId("environment-chart");
      expect(chart).toHaveAttribute("data-window-start", String(NOW - 24 * HOUR));
      expect(chart).toHaveAttribute("data-window-end", String(NOW));
    });

    it("drops readings that left the window as time passes without new readings", () => {
      const { rerender } = renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Última hora" }));
      expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-points", "2");

      // The 12:30 bucket (until 12:31) is still inside the hour that ends at 13:30:30; the 12:29 one is not.
      clock.now = Date.parse("2026-10-10T13:30:30Z");
      rerenderPage(rerender);
      expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-points", "1");
      expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-window-end", String(clock.now));

      clock.now = Date.parse("2026-10-10T14:00:00Z");
      rerenderPage(rerender);
      expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
      expect(screen.getByText("No hay lecturas de este dispositivo en el período elegido.")).toBeInTheDocument();
    });
  });

  describe("establishment view while another range or establishment loads", () => {
    const loading = () => state(undefined, { isLoading: true, isPending: true });
    const readingsCard = () => screen.getByRole("region", { name: "Lecturas" });
    const busyChart = () => screen.getByTestId("environment-chart").closest("[aria-busy='true']");

    it("keeps the previous merged chart, dimmed, until the new range has data", () => {
      useEstablishmentDevices();
      const { rerender } = renderPage();
      openEstablishmentView();
      expect(busyChart()).toBeNull();

      telemetry.aggregate = loading();
      fireEvent.click(screen.getByRole("button", { name: "Última hora" }));

      expect(within(readingsCard()).queryByRole("status")).not.toBeInTheDocument();
      expect(chartSeries()).toEqual(["Sensor Sur · DHT22", "Sensor Norte · DHT22"]);
      expect(busyChart()).not.toBeNull();
      // Still the data (and bucket) of the previous range.
      expect(screen.getByText("2 dispositivos · 2 sensores · promedio cada 1 min")).toBeInTheDocument();

      telemetry.aggregate = state({ ...aggregateReadings, bucket: "15m", bucketSeconds: 900 });
      rerender(
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>,
      );

      expect(busyChart()).toBeNull();
      expect(screen.getByText("2 dispositivos · 2 sensores · promedio cada 15 min")).toBeInTheDocument();
    });

    it("keeps the previous establishment chart while the chosen one loads", () => {
      useEstablishmentDevices();
      renderPage();
      openEstablishmentView();

      telemetry.aggregate = loading();
      fireEvent.change(screen.getByLabelText("Establecimiento"), { target: { value: "environment-2" } });

      expect(within(readingsCard()).queryByRole("status")).not.toBeInTheDocument();
      expect(chartSeries()).toEqual(["Sensor Sur · DHT22", "Sensor Norte · DHT22"]);
      expect(busyChart()).not.toBeNull();
    });

    it("shows the skeleton when there is nothing loaded yet", () => {
      useEstablishmentDevices();
      telemetry.aggregate = loading();
      renderPage();
      openEstablishmentView();

      expect(screen.getByRole("status", { name: "Cargando lecturas del establecimiento" })).toBeInTheDocument();
      expect(screen.queryByTestId("environment-chart")).not.toBeInTheDocument();
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
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-offline-enabled", "24h", "now", "auto"]);
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
      ["telemetry", "aggregate", "device-presence-unavailable", "24h", "now", "auto"],
    ]);
  });

  it("selects the first online device by default and lets the user switch device", () => {
    renderPage();

    const select = screen.getByLabelText("Dispositivo") as HTMLSelectElement;
    expect(select.value).toBe("device-online");
    expect(screen.getByRole("link", { name: "Ver detalle" })).toHaveAttribute("href", "/app/devices/device-online");

    fireEvent.change(select, { target: { value: "device-offline-enabled" } });

    expect(lastTelemetryQuery("latest").queryKey.slice(0, 3)).toEqual(["telemetry", "latest", "device-offline-enabled"]);
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-offline-enabled", "24h", "now", "auto"]);
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
      return telemetryState(queryKey);
    });
    rerender(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect((screen.getByLabelText("Dispositivo") as HTMLSelectElement).value).toBe("device-online");
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "24h", "now", "auto"]);
  });

  it("changes the period with the range presets and keeps rolling keys stable", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Últimas 24 horas" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" }));
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "7d", "now", "auto"]);

    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" }));
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "30d", "now", "auto"]);

    fireEvent.click(screen.getByRole("button", { name: "Última hora" }));
    expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "1h", "now", "auto"]);
    expect(screen.getByRole("button", { name: "Última hora" })).toHaveAttribute("aria-pressed", "true");
    // The dashboard no longer reads raw history: the chart and the establishment table use aggregates.
    expect(queryConfigs().some((config) => config.queryKey[1] === "history")).toBe(false);
  });

  it("requests the rolling window and the browser offset when the aggregate query runs", async () => {
    const { environmentalSensorService } = await import("@/app/services/environmentalSensor.service");
    const getAggregate = vi.spyOn(environmentalSensorService, "getAggregate").mockResolvedValue(aggregateReadings as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:30:00.000Z"));
    try {
      renderPage();
      await lastTelemetryQuery("aggregate").queryFn();

      expect(getAggregate).toHaveBeenCalledWith("device-online", {
        start: "2026-10-09T12:30:00.000Z",
        end: "2026-10-10T12:30:00.000Z",
        bucket: "auto",
        utcOffsetMinutes: -new Date().getTimezoneOffset() || 0,
        maxPoints: 800,
      });
    } finally {
      vi.useRealTimers();
      getAggregate.mockRestore();
    }
  });

  describe("period navigation", () => {
    const DAY = 24 * HOUR;
    const iso = (time: number) => new Date(time).toISOString();
    const aggregateKey = () => lastTelemetryQuery("aggregate").queryKey;

    it("moves the window back and forth by its span and returns to the live preset", () => {
      renderPage();
      expect(screen.getByRole("button", { name: "Período siguiente" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Ahora" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
      expect(aggregateKey()).toEqual(["telemetry", "aggregate", "device-online", iso(NOW - 2 * DAY), iso(NOW - DAY), "auto"]);
      expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-window-end", String(NOW - DAY));
      expect(screen.getByRole("button", { name: "Últimas 24 horas" })).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
      expect(aggregateKey()).toEqual(["telemetry", "aggregate", "device-online", iso(NOW - 3 * DAY), iso(NOW - 2 * DAY), "auto"]);

      fireEvent.click(screen.getByRole("button", { name: "Período siguiente" }));
      expect(aggregateKey()).toEqual(["telemetry", "aggregate", "device-online", iso(NOW - 2 * DAY), iso(NOW - DAY), "auto"]);

      fireEvent.click(screen.getByRole("button", { name: "Período siguiente" }));
      expect(aggregateKey()).toEqual(["telemetry", "aggregate", "device-online", "24h", "now", "auto"]);
      expect(screen.getByRole("button", { name: "Período siguiente" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
      fireEvent.click(screen.getByRole("button", { name: "Ahora" }));
      expect(aggregateKey()).toEqual(["telemetry", "aggregate", "device-online", "24h", "now", "auto"]);
      expect(screen.getByRole("button", { name: "Últimas 24 horas" })).toHaveAttribute("aria-pressed", "true");
    });

    it("picks whole local days with the shared DateRangePicker", () => {
      renderPage();
      expect(screen.queryByRole("button", { name: "Elegir fechas" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
      expect(screen.getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
      const trigger = screen.getByRole("button", { name: "Elegir fechas" });
      // Starts from the window on screen (the last 24 hours), as whole days.
      expect(trigger).toHaveAttribute("data-to", new Date(clock.now).toDateString());

      picker.range = { from: new Date(2026, 9, 4, 15, 20), to: new Date(2026, 9, 6, 9, 5) };
      fireEvent.click(trigger);

      expect(aggregateKey()).toEqual([
        "telemetry", "aggregate", "device-online",
        new Date(2026, 9, 4, 0, 0, 0, 0).toISOString(),
        new Date(2026, 9, 6, 23, 59, 59, 999).toISOString(),
        "auto",
      ]);
      expect(screen.getByRole("button", { name: "Período siguiente" })).toBeEnabled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("uses a single day when only the start is picked", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));

      picker.range = { from: new Date(2026, 9, 2, 11) };
      fireEvent.click(screen.getByRole("button", { name: "Elegir fechas" }));

      expect(aggregateKey().slice(3, 5)).toEqual([
        new Date(2026, 9, 2, 0, 0, 0, 0).toISOString(),
        new Date(2026, 9, 2, 23, 59, 59, 999).toISOString(),
      ]);
    });

    it("refuses a custom range longer than 366 days", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
      const before = aggregateKey();

      picker.range = { from: new Date(2025, 0, 1), to: new Date(2026, 9, 1) };
      fireEvent.click(screen.getByRole("button", { name: "Elegir fechas" }));

      expect(screen.getByRole("alert")).toHaveTextContent("El período no puede superar los 366 días.");
      expect(aggregateKey()).toEqual(before);
    });
  });

  describe("aggregation level and function", () => {
    const levelSelect = () => screen.getByLabelText("Nivel de agregación") as HTMLSelectElement;
    const optionStates = () => Array.from(levelSelect().options).map((option) => [option.text, option.disabled]);

    it("shows the resolved automatic bucket and requests the chosen level", () => {
      renderPage();

      expect(levelSelect().value).toBe("auto");
      expect(optionStates()).toEqual([
        ["Automático · 1 min", false],
        ["1 min", false],
        ["5 min", false],
        ["15 min", false],
        ["1 h", false],
        ["6 h", false],
        ["1 día", false],
      ]);

      fireEvent.change(levelSelect(), { target: { value: "15m" } });
      expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "24h", "now", "15m"]);
    });

    it("disables the levels that exceed the bucket cap of the period and falls back to automatic", () => {
      renderPage();
      fireEvent.change(levelSelect(), { target: { value: "1m" } });

      fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" }));

      expect(optionStates()[1]).toEqual(["1 min", true]);
      expect(optionStates()[2]).toEqual(["5 min", false]);
      expect(levelSelect().value).toBe("auto");
      expect(lastTelemetryQuery("aggregate").queryKey).toEqual(["telemetry", "aggregate", "device-online", "30d", "now", "auto"]);
    });

    it("plots the chosen function and shows the min–max band only with the average", () => {
      renderPage();
      const chart = () => screen.getByTestId("environment-chart");
      expect(chart()).toHaveAttribute("data-values", "[23.1,23.4]");
      expect(chart()).toHaveAttribute("data-band", "true");

      fireEvent.click(screen.getByRole("switch", { name: "Mostrar rango mín–máx" }));
      expect(chart()).toHaveAttribute("data-band", "false");
      fireEvent.click(screen.getByRole("switch", { name: "Mostrar rango mín–máx" }));

      fireEvent.click(screen.getByRole("button", { name: "Mínimo" }));
      expect(chart()).toHaveAttribute("data-values", "[22.9,23]");
      expect(chart()).toHaveAttribute("data-band", "false");
      expect(screen.queryByRole("switch", { name: "Mostrar rango mín–máx" })).not.toBeInTheDocument();
      expect(screen.getByText("1 sensor · mínimo cada 1 min")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Máximo" }));
      expect(chart()).toHaveAttribute("data-values", "[23.3,23.8]");
    });
  });

  it("charts the selected device in a single chart with one series per sensor", () => {
    renderPage();

    const charts = screen.getAllByTestId("environment-chart");
    expect(charts).toHaveLength(1);
    expect(charts[0]).toHaveAttribute("data-variable", "temperature");
    expect(within(charts[0]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["DHT22"]);
    expect(screen.getByText("1 sensor · promedio cada 1 min")).toBeInTheDocument();
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
    const health = screen.getByRole("list", { name: "Estado del dispositivo" });
    expect(health).toHaveTextContent("WiFi Buena");
    expect(health).toHaveTextContent("Firmware 2.1.0");
    // The strip reads the live state; the latest rows load only for the records table.
    expect(lastTelemetryQuery("live").enabled).toBe(true);
    expect(lastTelemetryQuery("latest").enabled).toBe(false);

    fireEvent.click(within(items[1]).getByRole("button"));

    expect(screen.getByTestId("environment-chart")).toHaveAttribute("data-variable", "relative_humidity");
  });

  it("switches the device readings to the latest records table", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Gráfico" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tabla" }));

    expect(screen.getByRole("button", { name: "Tabla" })).toHaveAttribute("aria-pressed", "true");
    expect(lastTelemetryQuery("latest").enabled).toBe(true);
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
    telemetry.live = state({ ...liveState, time: null, values: {}, sensors: [], health: {} });
    telemetry.aggregate = state(emptyAggregate);

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
    expect(lastTelemetryQuery("live").enabled).toBe(false);
    expect(lastTelemetryQuery("aggregate").enabled).toBe(false);
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
      return telemetryState(queryKey);
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
      ["telemetry", "aggregate", "device-offline-enabled", "24h", "now", "auto"],
      ["telemetry", "aggregate", "device-online", "24h", "now", "auto"],
    ]);
    expect(queries.every((config) => config.enabled === true && config.refetchInterval === false)).toBe(true);
    expect(typeof queries[0].queryFn).toBe("function");

    const chart = screen.getByTestId("environment-chart");
    expect(chart).toHaveAttribute("data-variable", "temperature");
    expect(within(chart).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Sensor Sur · DHT22",
      "Sensor Norte · DHT22",
    ]);
    expect(screen.getByText("2 dispositivos · 2 sensores · promedio cada 1 min")).toBeInTheDocument();
  });

  it("loads the devices of the chosen establishment and shares the range presets", () => {
    useEstablishmentDevices();
    renderPage();
    openEstablishmentView();

    fireEvent.change(screen.getByLabelText("Establecimiento"), { target: { value: "environment-2" } });
    expect(lastEnvironmentQueries().map((config) => config.queryKey)).toEqual([
      ["telemetry", "aggregate", "device-presence-unavailable", "24h", "now", "auto"],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Última hora" }));
    expect(lastEnvironmentQueries().map((config) => config.queryKey)).toEqual([
      ["telemetry", "aggregate", "device-presence-unavailable", "1h", "now", "auto"],
    ]);
    expect(screen.getByText("1 dispositivo · 1 sensor · promedio cada 1 min")).toBeInTheDocument();
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
    telemetry.aggregateByDevice["device-online"] = state(undefined, { isError: true });
    renderPage();
    openEstablishmentView();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar las lecturas de 1 dispositivo(s)");
    const chart = screen.getByTestId("environment-chart");
    expect(within(chart).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Sensor Sur · DHT22"]);
  });

  it("shows loading and empty states for the establishment chart", () => {
    useEstablishmentDevices();
    telemetry.aggregate = state(undefined, { isLoading: true, isPending: true });
    const { rerender } = renderPage();
    openEstablishmentView();

    expect(screen.getByRole("status", { name: "Cargando lecturas del establecimiento" })).toBeInTheDocument();

    telemetry.aggregate = state({ ...emptyAggregate, sensors });
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

    fireEvent.click(screen.getByRole("button", { name: "Temperatura (°C)" }));
    fireEvent.click(screen.getByRole("button", { name: "Máximo" }));
    const maxRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(maxRows[0]).getAllByText("23,8")).toHaveLength(2);
    expect(within(maxRows[1]).getAllByText("23,3")).toHaveLength(2);
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

    telemetry.aggregate = state({ ...aggregateReadings, items: [...aggregateReadings.items] });
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
