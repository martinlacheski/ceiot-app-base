import { describe, expect, it } from "vitest";
import { cellText } from "@/lib/export.utils";
import { exportCellOf } from "./historyExport";
import { buildTelemetryColumns, formatTelemetryValue, mergeTelemetrySensors } from "./historyTelemetryColumns";

const dht = { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }, { code: "relative_humidity", name: "Humedad relativa", unit: "%" }] };
const bmp = { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [{ code: "temperature", name: "Temperatura", unit: "°C" }] };

describe("history telemetry columns", () => {
  it("keeps repeated variables separate by sensor key and formats es-AR numbers", () => {
    const columns = buildTelemetryColumns([dht, bmp]);
    expect(columns.map((column) => column.title)).toEqual(["Fecha/Hora", "DHT22 · Temperatura (°C)", "DHT22 · Humedad relativa (%)", "BMP280 · Temperatura (°C)"]);
    const row = { time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 23.4 }, bmp280: { temperature: 22.9 } } };
    expect(columns[1].value(row)).toBe("23,4 °C");
    expect(columns[2].value(row)).toBe("-");
    expect(columns[3].value(row)).toBe("22,9 °C");
    expect(formatTelemetryValue(0, "%")).toBe("0 %");
  });

  it("unions sensor metadata from every export page", () => {
    expect(mergeTelemetrySensors([dht], [bmp, dht]).map((sensor) => sensor.key)).toEqual(["dht22", "bmp280"]);
  });

  it("exports the date column and sensor readings as typed cells keeping the displayed text", () => {
    const columns = buildTelemetryColumns([dht]);
    const row = { time: "2026-09-01T12:00:00Z", values: { dht22: { temperature: 23.4, relative_humidity: null } } };
    const time = exportCellOf(columns[0], row);
    expect(time).toMatchObject({ kind: "datetime", value: "2026-09-01T12:00:00Z" });
    expect(cellText(time)).toBe(columns[0].value(row));
    expect(exportCellOf(columns[1], row)).toMatchObject({ kind: "decimal", value: 23.4, decimals: 1, text: "23,4 °C" });
    expect(exportCellOf(columns[2], row)).toMatchObject({ kind: "decimal", value: null, text: "-" });
  });

  it("falls back to the displayed text for columns without a typed export", () => {
    expect(exportCellOf({ id: "x", title: "X", value: () => "texto" }, {})).toBe("texto");
  });
});
