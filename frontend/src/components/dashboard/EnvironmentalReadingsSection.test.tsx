import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentalReadingsSection } from "./EnvironmentalReadingsSection";

vi.mock("./charts/EnvironmentalReadingsChart", () => ({
  EnvironmentalReadingsChart: ({ variableCode, sensors }: { variableCode: string; sensors: unknown[] }) => <div data-testid={`chart-${variableCode}`}>{sensors.length} series</div>,
}));

const sensors = [
  { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }, { code: "relative_humidity", name: "Humedad relativa", unit: "%" }] },
  { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }, { code: "pressure", name: "Presión", unit: "hPa" }] },
];
const latest = { items: [{ time: "2026-09-21T12:30:00Z", values: { dht22: { temperature: 23.4, relative_humidity: 55.1 }, bmp280: { temperature: 22.9, pressure: 1012.6 } } }], total: 1, sensors };

 describe("EnvironmentalReadingsSection", () => {
  it("groups current measurements by sensor and charts by variable", () => {
    render(<EnvironmentalReadingsSection latest={latest} history={latest} isLoading={false} isError={false} />);
    expect(screen.getByText(/23,4 °C/)).toBeInTheDocument();
    expect(screen.getByText(/22,9 °C/)).toBeInTheDocument();
    expect(screen.getByText(/55,1 %/)).toBeInTheDocument();
    expect(screen.getByTestId("chart-temperature")).toHaveTextContent("2 series");
    expect(screen.getByTestId("chart-pressure")).toHaveTextContent("1 series");
  });
  it("does not fabricate readings for empty, loading, or error responses", () => {
    const empty = { items: [], total: 0, sensors: [] };
    const { rerender } = render(<EnvironmentalReadingsSection latest={empty} history={empty} isLoading={false} isError={false} />);
    expect(screen.getByText("Aún no hay lecturas ambientales.")).toBeInTheDocument();
    rerender(<EnvironmentalReadingsSection isLoading isError={false} />);
    expect(screen.getByText("Cargando lecturas ambientales…")).toBeInTheDocument();
    rerender(<EnvironmentalReadingsSection isLoading={false} isError />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las lecturas ambientales.");
  });
  it("keeps current values visible when history fails", () => {
    render(<EnvironmentalReadingsSection latest={latest} latestLoading={false} latestError={false} historyError historyLoading={false} />);
    expect(screen.getByText(/23,4 °C/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar el historial de lecturas.");
  });
});
