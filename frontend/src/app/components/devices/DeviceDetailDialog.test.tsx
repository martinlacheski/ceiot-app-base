import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Device } from "@/app/types/device.types";

import { DeviceDetailDialog } from "./DeviceDetailDialog";

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(),
  getLatest: vi.fn(),
  useQuery: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  history: undefined as unknown,
  latest: undefined as unknown,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/app/services/environmentalSensor.service", () => ({
  environmentalSensorService: {
    getHistory: mocks.getHistory,
    getLatest: mocks.getLatest,
  },
}));

vi.mock("@/components/dashboard/charts/EnvironmentalReadingsChart", () => ({
  EnvironmentalReadingsChart: ({ variableCode }: { variableCode: string }) => <div data-testid={`chart-${variableCode}`} />,
}));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: () => ({ user: { permissions: ["telemetry:read"], isAdmin: false } }) }));

const device: Device = {
  id: "device-1",
  serial: "IOT-0000-0001",
  name: "Sensor Norte",
  description: "Monitoreo ambiental",
  deviceTypeId: "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32",
  status: "active",
  isActive: true,
  enabled: true,
  brokerConnected: false,
};

const reading = { time: "2026-09-21T12:30:00Z", values: { dht22: { temperature: 24.5, relative_humidity: 61, pressure: 1013.2 } } };
const sensors = [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }, { code: "relative_humidity", name: "Humedad relativa", unit: "%" }, { code: "pressure", name: "Presión", unit: "hPa" }] }];

const queryResult = (
  data?: unknown,
  options: { isError?: boolean; isLoading?: boolean } = {},
) => ({
  data,
  isError: options.isError ?? false,
  isLoading: options.isLoading ?? false,
});

function renderDialog(brokerConnected: boolean | null = device.brokerConnected) {
  return render(
    <DeviceDetailDialog
      device={{ ...device, brokerConnected }}
      open
      onOpenChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryState.latest = queryResult({ items: [], total: 0, sensors: [] });
  queryState.history = queryResult({ items: [], total: 0, sensors: [] });
  mocks.useQuery.mockImplementation(
    (options: { queryKey: readonly unknown[] }) => {
      if (options.queryKey[1] === "latest") return queryState.latest;
      if (options.queryKey[1] === "history") return queryState.history;
      throw new Error(`Unexpected query key: ${String(options.queryKey)}`);
    },
  );
});

describe("DeviceDetailDialog", () => {
  it.each([
    [true, "En línea"],
    [false, "Fuera de línea"],
    [null, "No disponible"],
  ] as const)(
    "shows %s broker presence as %s separately from the active state",
    (presence, label) => {
      renderDialog(presence);

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(
        screen
          .getAllByText("ACTIVO")
          .some((element) => element.dataset.slot === "badge"),
      ).toBe(true);
      if (presence === null) {
        expect(screen.queryByText("Fuera de línea")).not.toBeInTheDocument();
      }
    },
  );

  it("shows generic device identity without commercial data", () => {
    renderDialog();

    expect(screen.getByText("Sensor Norte")).toBeInTheDocument();
    expect(screen.getByText("IOT-0000-0001")).toBeInTheDocument();
    expect(screen.queryByText(/dispensador/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Importe:")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$\s/)).not.toBeInTheDocument();
  });

  it("shows the backend update timestamp", () => {
    render(
      <DeviceDetailDialog
        device={{ ...device, updatedAt: "2026-09-23T15:45:00Z" }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Actualizado:/)).toBeInTheDocument();
  });

  it("queries both environmental endpoints every 5 seconds while open", () => {
    renderDialog();

    const environmentalQueries = mocks.useQuery.mock.calls.map(
      ([options]) => options,
    );
    expect(environmentalQueries).toHaveLength(2);
    expect(environmentalQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queryKey: ["telemetry", "latest", "device-1"],
          enabled: true,
          refetchInterval: 5000,
        }),
        expect.objectContaining({
          queryKey: ["telemetry", "history", "device-1", "24h"],
          enabled: true,
          refetchInterval: 5000,
        }),
      ]),
    );
  });

  it("shows the environmental loading state", () => {
    queryState.latest = queryResult(undefined, { isLoading: true });
    queryState.history = queryResult(undefined, { isLoading: true });

    renderDialog();

    expect(
      screen.getByText("Cargando lecturas ambientales…"),
    ).toBeInTheDocument();
  });

  it("shows the environmental error state", () => {
    queryState.history = queryResult(undefined, { isError: true });

    renderDialog();

    expect(
      screen.getByText("No se pudo cargar el historial de lecturas."),
    ).toBeInTheDocument();
  });

  it("shows an honest empty state", () => {
    renderDialog();

    expect(
      screen.getByText("Aún no hay lecturas ambientales."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:[.,]\d+)?\s*°C/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:[.,]\d+)?\s*hPa/)).not.toBeInTheDocument();
  });

  it("shows current values, timestamp, and history consistently", () => {
    queryState.latest = queryResult({ items: [reading], total: 1, sensors });
    queryState.history = queryResult({ items: [reading], total: 1, sensors });

    renderDialog();

    expect(screen.getByText(/24[.,]5\s*°C/)).toBeInTheDocument();
    expect(screen.getByText(/61\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/1[.]?013[.,]2\s*hPa/)).toBeInTheDocument();
    expect(screen.getByText(/Última lectura:/)).toBeInTheDocument();
    expect(
      document.querySelector('time[datetime="2026-09-21T12:30:00Z"]'),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chart-temperature")).toBeInTheDocument();
  });
});
