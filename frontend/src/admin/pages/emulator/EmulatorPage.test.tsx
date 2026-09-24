import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import EmulatorPage from "./EmulatorPage";

const {
  devicesState,
  sensorsState,
  sendMutateAsync,
  requestMutateAsync,
} = vi.hoisted(() => ({
  devicesState: {
    items: [] as Array<{ id: string; serial: string; name: string }>,
    isLoading: false,
  },
  sensorsState: {
    byDevice: {} as Record<
      string,
      Array<{
        key: string;
        sensorId: string;
        sensorCode: string;
        sensorName: string;
        variables: Array<{
          code: string;
          name: string;
          unit: string;
          minValue: number;
          maxValue: number;
        }>;
      }>
    >,
    isLoading: false,
  },
  sendMutateAsync: vi.fn(),
  requestMutateAsync: vi.fn(),
}));

vi.mock("@/app/hooks/useDevices", () => ({
  useDevices: () => ({
    data: { items: devicesState.items },
    isLoading: devicesState.isLoading,
  }),
}));

vi.mock("@/app/hooks/useEmulator", () => ({
  useEmulatorSensors: (deviceId: string | undefined) => ({
    data: deviceId ? (sensorsState.byDevice[deviceId] ?? []) : undefined,
    isLoading: sensorsState.isLoading,
  }),
  useSendEmulatorTelemetry: () => ({
    mutateAsync: sendMutateAsync,
    isPending: false,
  }),
  useRequestEmulatorTime: () => ({
    mutateAsync: requestMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: Array<{ label: string; value: string }>;
    value?: string;
    onChange: (value: string | undefined) => void;
    placeholder?: string;
  }) => (
    <select
      aria-label={placeholder}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const deviceSelect = () =>
  screen.getByRole("combobox", { name: /seleccionar dispositivo/i });

const seedDevice = () => {
  devicesState.items = [
    { id: "device-1", serial: "IOT-0000-0001", name: "Sensor Norte" },
  ];
  sensorsState.byDevice["device-1"] = [
    {
      key: "dht22",
      sensorId: "sensor-1",
      sensorCode: "dht22",
      sensorName: "DHT22",
      variables: [
        { code: "temperature", name: "Temperatura", unit: "°C", minValue: 0, maxValue: 50 },
        {
          code: "relative_humidity",
          name: "Humedad relativa",
          unit: "%",
          minValue: 0,
          maxValue: 100,
        },
      ],
    },
  ];
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <EmulatorPage />
    </MemoryRouter>,
  );

const selectDevice = async () => {
  const user = userEvent.setup();
  await user.selectOptions(deviceSelect(), "device-1");
  return user;
};

describe("EmulatorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    devicesState.items = [];
    devicesState.isLoading = false;
    sensorsState.byDevice = {};
    sensorsState.isLoading = false;
    sendMutateAsync.mockResolvedValue({
      topic: "iot/devices/IOT-0000-0001/telemetry",
      payload: { sensors: {}, firmware_version: "emulador" },
    });
    requestMutateAsync.mockResolvedValue({
      reqId: "abc123",
      topic: "iot/devices/IOT-0000-0001/time/request",
    });
  });

  it("renders the device selector and loads active sensors with catalog ranges once a device is chosen", async () => {
    seedDevice();
    renderPage();

    expect(deviceSelect()).toBeInTheDocument();
    await selectDevice();

    expect(screen.getByText(/DHT22/)).toBeInTheDocument();
    expect(
      screen.getByText(/Temperatura \(°C\) — \[0, 50\]/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Humedad relativa \(%\) — \[0, 100\]/),
    ).toBeInTheDocument();
  });

  it("seeds each control at the midpoint of its range and sends the exact payload shape on Enviar lectura", async () => {
    seedDevice();
    renderPage();
    await selectDevice();

    await userEvent.click(screen.getByRole("button", { name: "Enviar lectura" }));

    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({
        deviceId: "device-1",
        body: {
          sensors: {
            dht22: { temperature: 25, relative_humidity: 50 },
          },
        },
      }),
    );
  });

  it("clamps a manual value typed above the max instead of submitting it out of range", async () => {
    seedDevice();
    renderPage();
    await selectDevice();

    const temperatureInput = screen.getByLabelText("DHT22 Temperatura numérico");
    fireEvent.change(temperatureInput, { target: { value: "999" } });

    expect(temperatureInput).toHaveValue(50);

    await userEvent.click(screen.getByRole("button", { name: "Enviar lectura" }));

    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({
        deviceId: "device-1",
        body: {
          sensors: {
            dht22: { temperature: 50, relative_humidity: 50 },
          },
        },
      }),
    );
  });

  it("clamps a manual value typed below the min", async () => {
    seedDevice();
    renderPage();
    await selectDevice();

    const humidityInput = screen.getByLabelText("DHT22 Humedad relativa numérico");
    fireEvent.change(humidityInput, { target: { value: "-40" } });

    expect(humidityInput).toHaveValue(0);
  });

  it("runs auto mode on an interval with a bounded random walk, and stops on demand", async () => {
    seedDevice();
    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        fireEvent.change(deviceSelect(), { target: { value: "device-1" } });
      });

      fireEvent.change(screen.getByLabelText("Cada (s)"), {
        target: { value: "1" },
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Envío automático cada N s" }),
        );
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(sendMutateAsync.mock.calls.length).toBeGreaterThanOrEqual(3);

      for (const call of sendMutateAsync.mock.calls) {
        const sensors = call[0].body.sensors;
        expect(sensors.dht22.temperature).toBeGreaterThanOrEqual(0);
        expect(sensors.dht22.temperature).toBeLessThanOrEqual(50);
        expect(sensors.dht22.relative_humidity).toBeGreaterThanOrEqual(0);
        expect(sensors.dht22.relative_humidity).toBeLessThanOrEqual(100);
      }

      // Not a static resend: at least one tick should differ from the seeded midpoint.
      const sawChange = sendMutateAsync.mock.calls.some(
        (call) => call[0].body.sensors.dht22.temperature !== 25,
      );
      expect(sawChange).toBe(true);

      const callsWhileRunning = sendMutateAsync.mock.calls.length;
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Detener envío automático" }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(sendMutateAsync.mock.calls.length).toBe(callsWhileRunning);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the returned reqId and topic when testing a time request", async () => {
    seedDevice();
    renderPage();
    await selectDevice();

    await userEvent.click(
      screen.getByRole("button", { name: "Probar pedido de hora" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/reqId=abc123/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/iot\/devices\/IOT-0000-0001\/time\/request/),
    ).toBeInTheDocument();
  });

  it("says nothing was found when the device has no active sensors", async () => {
    devicesState.items = [
      { id: "device-2", serial: "IOT-0000-0002", name: "Sin sensores" },
    ];
    sensorsState.byDevice["device-2"] = [];
    renderPage();

    await userEvent.selectOptions(deviceSelect(), "device-2");

    expect(
      screen.getByText("Este dispositivo no tiene sensores activos instalados"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enviar lectura" }),
    ).not.toBeInTheDocument();
  });
});
