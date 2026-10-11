import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveTelemetry } from "@/app/types/environmentalSensor.types";
import { CurrentValuesStrip } from "./CurrentValuesStrip";

const live: LiveTelemetry = {
  source: "redis",
  time: new Date(Date.now() - 2 * 60_000).toISOString(),
  values: { dht22: { temperature: 23.4, relative_humidity: 51.25 } },
  health: { wifi_rssi: -67, firmware_version: "1.4.2", uptime: 99 },
  presence: "online",
  sensors: [{
    key: "dht22",
    sensorCode: "dht22",
    sensorName: "DHT22",
    variables: [
      { code: "temperature", name: "Temperatura", unit: "°C" },
      { code: "relative_humidity", name: "Humedad", unit: "%" },
    ],
  }],
};

describe("CurrentValuesStrip", () => {
  it("shows the live values, the last reading age and compact device health in one row", () => {
    const onSelect = vi.fn();
    render(<CurrentValuesStrip live={live} isLoading={false} isError={false} onSelectVariable={onSelect} />);

    const items = within(screen.getByRole("list", { name: "Valores actuales" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Temperatura23,4 °C", "Humedad51,25 %"]);
    expect(screen.getByText(/^Última lectura hace /)).toBeInTheDocument();
    const health = screen.getByRole("list", { name: "Estado del dispositivo" });
    expect(within(health).getByText("WiFi Regular")).toHaveAttribute("title", "Señal WiFi: -67 dBm");
    expect(within(health).getByText("Firmware 1.4.2")).toBeInTheDocument();

    fireEvent.click(within(items[1]).getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("relative_humidity");
  });

  it("omits the health items the device did not report", () => {
    render(<CurrentValuesStrip live={{ ...live, health: {} }} isLoading={false} isError={false} onSelectVariable={vi.fn()} />);

    expect(screen.queryByRole("list", { name: "Estado del dispositivo" })).not.toBeInTheDocument();
  });

  it("renders nothing without readings and reports a failed first load", () => {
    const { container, rerender } = render(
      <CurrentValuesStrip live={{ ...live, time: null, values: {}, sensors: [], health: {} }} isLoading={false}
        isError={false} onSelectVariable={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<CurrentValuesStrip isLoading={false} isError onSelectVariable={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los valores actuales.");
  });
});
