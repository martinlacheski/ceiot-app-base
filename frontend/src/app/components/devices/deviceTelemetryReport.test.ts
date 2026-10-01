import { describe, expect, it } from "vitest";
import { cellText } from "@/lib/export.utils";
import type { DailyTelemetry, TelemetryItem } from "@/app/types/environmentalSensor.types";
import { buildDailyExport, buildDetailedExport, reportFilename, reportSubtitle } from "./deviceTelemetryReport";

const dht = { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }, { code: "relative_humidity", name: "Humedad relativa", unit: "%" }] };
const bmp = { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "pressure", name: "Presión", unit: "hPa" }] };
const daily: DailyTelemetry = {
  sensors: [dht, bmp],
  days: [
    { date: "2026-09-02", sensors: { dht22: { temperature: { min: 10, max: 20.55, avg: 15.25, count: 4 }, relative_humidity: { min: 40, max: 60, avg: 50, count: 3 } }, bmp280: { pressure: { min: 1000, max: 1010.123, avg: 1005, count: 4 } } } },
    { date: "2026-09-03", sensors: { dht22: { temperature: { min: 11, max: 12, avg: 11.5, count: 1 } } } },
  ],
};

describe("telemetry report builders", () => {
  it("builds the subtitle with device and period (local dates)", () => {
    const start = new Date(2026, 8, 1, 0, 0).toISOString();
    const end = new Date(2026, 8, 30, 23, 59).toISOString();
    expect(reportSubtitle({ name: "Sala", serial: "IOT-DEM0-0003" }, start, end))
      .toBe("Dispositivo: Sala (IOT-DEM0-0003) · Período: 01/09/2026 00:00 - 30/09/2026 23:59");
    expect(reportSubtitle({ name: null, serial: "IOT-DEM0-0003" }, start, end)).toContain("Dispositivo: IOT-DEM0-0003 ·");
  });

  it("names files with the serial and the local dates", () => {
    const start = new Date(2026, 8, 1, 0, 0).toISOString();
    const end = new Date(2026, 8, 30, 23, 59).toISOString();
    expect(reportFilename("daily", "IOT-DEM0-0003", start, end)).toBe("resumen-diario-telemetria_IOT-DEM0-0003_2026-09-01_2026-09-30");
    expect(reportFilename("detailed", "IOT-DEM0-0003", start, end)).toBe("telemetria-detallada_IOT-DEM0-0003_2026-09-01_2026-09-30");
  });

  it("builds the daily export: date cells, min/max/avg per variable with units, readings", () => {
    const { columns, data } = buildDailyExport(daily);
    expect(columns).toEqual([
      "Fecha",
      "DHT22 · Temperatura (°C) · Mín", "DHT22 · Temperatura (°C) · Máx", "DHT22 · Temperatura (°C) · Prom",
      "DHT22 · Humedad relativa (%) · Mín", "DHT22 · Humedad relativa (%) · Máx", "DHT22 · Humedad relativa (%) · Prom",
      "BMP280 · Presión (hPa) · Mín", "BMP280 · Presión (hPa) · Máx", "BMP280 · Presión (hPa) · Prom",
      "Lecturas",
    ]);
    expect(data).toHaveLength(2);
    expect(data[0][0]).toMatchObject({ kind: "date", value: "2026-09-02", text: "02/09/2026" });
    expect(data[0][2]).toMatchObject({ kind: "decimal", value: 20.55, decimals: 1 });
    expect(cellText(data[0][2])).toBe("20,55 °C");
    expect(data[0][8]).toMatchObject({ kind: "decimal", value: 1010.123, decimals: 2 });
    expect(cellText(data[0][8])).toBe("1.010,123 hPa");
    expect(data[0][10]).toMatchObject({ kind: "integer", value: 4 });
    // Missing sensor/variable on a day: empty typed cell, text "-".
    expect(data[1][4]).toMatchObject({ kind: "decimal", value: null });
    expect(cellText(data[1][4])).toBe("-");
    expect(data[1][10]).toMatchObject({ kind: "integer", value: 1 });
  });

  it("builds the detailed export with datetime cells and one column per sensor variable", () => {
    const rows: TelemetryItem[] = [{ time: "2026-09-02T12:30:00Z", values: { dht22: { temperature: 23.44, relative_humidity: null } } }];
    const { columns, data } = buildDetailedExport(rows, [dht]);
    expect(columns).toEqual(["Fecha y hora", "DHT22 · Temperatura (°C)", "DHT22 · Humedad relativa (%)"]);
    expect(data[0][0]).toMatchObject({ kind: "datetime", value: "2026-09-02T12:30:00Z" });
    expect(data[0][1]).toMatchObject({ kind: "decimal", value: 23.44, decimals: 1 });
    expect(data[0][2]).toMatchObject({ kind: "decimal", value: null });
  });
});
