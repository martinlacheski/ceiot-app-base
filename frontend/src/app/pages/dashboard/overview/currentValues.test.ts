import { describe, expect, it } from "vitest";

import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { collectCurrentValues } from "./currentValues";

const TEMPERATURE = { code: "temperature", name: "Temperatura", unit: "°C" };
const HUMIDITY = { code: "relative_humidity", name: "Humedad", unit: "%" };

const page: TelemetryPage = {
  items: [
    { time: "2026-10-10T12:29:00Z", values: { dht22: { temperature: 23.1, relative_humidity: null } } },
    { time: "2026-10-10T12:30:00Z", values: { dht22: { temperature: 23.4 }, bmp280: { temperature: null } } },
    { time: "2026-10-10T12:20:00Z", values: { dht22: { relative_humidity: 50 }, bmp280: { temperature: 21 } } },
  ],
  total: 3,
  sensors: [
    { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [TEMPERATURE, HUMIDITY] },
    { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [TEMPERATURE] },
  ],
};

describe("collectCurrentValues", () => {
  it("takes the newest non-null value of every sensor variable", () => {
    const { values } = collectCurrentValues(page);

    expect(values).toEqual([
      { id: "dht22:temperature", sensorName: "DHT22", variable: TEMPERATURE, value: 23.4 },
      { id: "dht22:relative_humidity", sensorName: "DHT22", variable: HUMIDITY, value: 50 },
      { id: "bmp280:temperature", sensorName: "BMP280", variable: TEMPERATURE, value: 21 },
    ]);
  });

  it("reports the newest reading time regardless of item order", () => {
    expect(collectCurrentValues(page).lastTime).toBe("2026-10-10T12:30:00Z");
  });

  it("keeps sensor variables without readings as null and handles a missing page", () => {
    const empty: TelemetryPage = { items: [], total: 0, sensors: page.sensors.slice(1) };

    expect(collectCurrentValues(empty)).toEqual({
      values: [{ id: "bmp280:temperature", sensorName: "BMP280", variable: TEMPERATURE, value: null }],
      lastTime: undefined,
    });
    expect(collectCurrentValues(undefined)).toEqual({ values: [], lastTime: undefined });
  });
});
