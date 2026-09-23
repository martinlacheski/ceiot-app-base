import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeviceDetailPage from "./DeviceDetailPage";

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(),
  getLatest: vi.fn(),
  guestCard: vi.fn<(props: Record<string, unknown>) => void>(),
  useQuery: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  brokerConnected: true as boolean | null,
  history: undefined as unknown,
  latest: undefined as unknown,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/app/services/sensorReading.service", () => ({
  sensorReadingService: {
    getHistory: mocks.getHistory,
    getLatest: mocks.getLatest,
  },
}));

vi.mock("@/components/dashboard/charts/EnvironmentalReadingsChart", () => ({
  EnvironmentalReadingsChart: ({
    readings,
  }: {
    readings: Array<unknown>;
  }) => <div data-testid="environmental-chart">{readings.length} puntos</div>,
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({ user: { id: "owner-1" } }),
}));

vi.mock("@/app/components/access/DeviceGuestManagementCard", () => ({
  DeviceGuestManagementCard: (props: Record<string, unknown>) => {
    mocks.guestCard(props);
    return <div>Access management</div>;
  },
}));

const device = {
  id: "device-1",
  name: "Environmental sensor",
  serial: "SENSOR-001",
  brokerConnected: true,
  environment: { id: "env-1", name: "Greenhouse", ownerId: "owner-1" },
};

const reading = {
  id: "reading-1",
  time: "2026-09-21T12:30:00Z",
  deviceId: "device-1",
  deviceSerial: "SENSOR-001",
  deviceType: "environmental",
  temperatureC: 24.5,
  relativeHumidityPct: 61,
  pressureHpa: 1013.2,
};

const queryResult = (
  data?: unknown,
  options: { isError?: boolean; isLoading?: boolean } = {},
) => ({
  data,
  isError: options.isError ?? false,
  isLoading: options.isLoading ?? false,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/devices/device-1"]}>
      <Routes>
        <Route path="/app/devices/:id" element={<DeviceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryState.brokerConnected = true;
  queryState.latest = queryResult({ items: [], total: 0 });
  queryState.history = queryResult({ items: [], total: 0 });
  mocks.useQuery.mockImplementation(
    (options: { queryKey: readonly unknown[] }) => {
      if (options.queryKey[0] === "device") {
        return queryResult({
          ...device,
          brokerConnected: queryState.brokerConnected,
        });
      }
      if (options.queryKey[1] === "latest") return queryState.latest;
      if (options.queryKey[1] === "history") return queryState.history;
      throw new Error(`Unexpected query key: ${String(options.queryKey)}`);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceDetailPage", () => {
  it.each([
    [true, "En línea"],
    [false, "Fuera de línea"],
    [null, "No disponible"],
  ] as const)("shows %s broker presence as %s", (presence, label) => {
    queryState.brokerConnected = presence;

    renderPage();

    expect(screen.getByText(label)).toBeInTheDocument();
    if (presence === null) {
      expect(screen.queryByText("Fuera de línea")).not.toBeInTheDocument();
    }
  });

  it("passes only access identity and ownership to guest management", () => {
    renderPage();

    expect(screen.getByText("Access management")).toBeInTheDocument();
    expect(mocks.guestCard).toHaveBeenCalledWith({
      deviceId: "device-1",
      isOwner: true,
    });
  });

  it("queries the latest reading and a rolling 24-hour history every 5 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:30:00.000Z"));
    mocks.getLatest.mockResolvedValue({ items: [], total: 0 });
    mocks.getHistory.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    const queryOptions = mocks.useQuery.mock.calls.map(([options]) => options);
    const latestQuery = queryOptions.find(
      (options) => options.queryKey[1] === "latest",
    );
    const historyQuery = queryOptions.find(
      (options) => options.queryKey[1] === "history",
    );
    expect(latestQuery).toMatchObject({ enabled: true, refetchInterval: 5000 });
    expect(historyQuery).toMatchObject({ enabled: true, refetchInterval: 5000 });

    await latestQuery.queryFn();
    await historyQuery.queryFn();

    expect(mocks.getLatest).toHaveBeenCalledWith("device-1", 1);
    expect(mocks.getHistory).toHaveBeenCalledWith(
      "device-1",
      "2026-09-20T12:30:00.000Z",
      "2026-09-21T12:30:00.000Z",
    );
  });

  it("shows the environmental loading state", () => {
    queryState.latest = queryResult(undefined, { isLoading: true });
    queryState.history = queryResult(undefined, { isLoading: true });

    renderPage();

    expect(screen.getByText("Lecturas ambientales")).toBeInTheDocument();
    expect(
      screen.getByText("Cargando lecturas ambientales…"),
    ).toBeInTheDocument();
  });

  it("shows the environmental error state", () => {
    queryState.latest = queryResult(undefined, { isError: true });

    renderPage();

    expect(
      screen.getByText("No se pudieron cargar las lecturas ambientales."),
    ).toBeInTheDocument();
  });

  it("shows an honest empty state without fabricated measurements", () => {
    renderPage();

    expect(
      screen.getByText("Aún no hay lecturas ambientales."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:[.,]\d+)?\s*°C/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:[.,]\d+)?\s*hPa/)).not.toBeInTheDocument();
  });

  it("shows current values, their timestamp, and the available history", () => {
    queryState.latest = queryResult({ items: [reading], total: 1 });
    queryState.history = queryResult({ items: [reading], total: 1 });

    renderPage();

    expect(screen.getByText(/24[.,]5\s*°C/)).toBeInTheDocument();
    expect(screen.getByText(/61\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/1013[.,]2\s*hPa/)).toBeInTheDocument();
    expect(screen.getByText(/Última lectura:/)).toBeInTheDocument();
    expect(
      document.querySelector('time[datetime="2026-09-21T12:30:00Z"]'),
    ).toBeInTheDocument();
    expect(screen.getByTestId("environmental-chart")).toHaveTextContent(
      "1 puntos",
    );
  });

  it("labels unavailable measurements instead of converting nulls to zero", () => {
    queryState.latest = queryResult({
      items: [
        {
          ...reading,
          temperatureC: null,
          relativeHumidityPct: null,
          pressureHpa: null,
        },
      ],
      total: 1,
    });

    renderPage();

    expect(screen.getAllByText("Sin dato")).toHaveLength(3);
    expect(screen.queryByText(/0\s*°C/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0\s*hPa/)).not.toBeInTheDocument();
  });
});
