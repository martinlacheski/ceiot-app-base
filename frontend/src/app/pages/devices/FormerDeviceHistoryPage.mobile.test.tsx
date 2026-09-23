import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadingMobileCards } from "@/app/components/devices/ReadingMobileCards";
import type { HistoryReading } from "@/api/deviceHistory.api";

describe("history mobile cards", () => {
  it("shows environmental values and false power state, without payment data", () => {
    const reading = { id: "r-1", time: "2026-09-01T12:00:00Z", temperatureC: 21, relativeHumidityPct: 40, pressureHpa: 1013, powerSupplyState: false, firmwareVersion: "1.2", wifiRssi: -50, lastError: null } as HistoryReading;
    render(<ReadingMobileCards readings={[reading]} />);
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("Temperatura: 21 °C");
    expect(card).toHaveTextContent("Humedad: 40 %");
    expect(card).toHaveTextContent("Presión: 1013 hPa");
    expect(card).toHaveTextContent("Alimentación: No");
    expect(card).not.toHaveTextContent(/importe|pago|método/i);
  });
});
