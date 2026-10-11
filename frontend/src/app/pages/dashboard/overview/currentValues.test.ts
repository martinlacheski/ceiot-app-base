import { describe, expect, it } from "vitest";

import type { LiveTelemetry, TelemetryPage } from "@/app/types/environmentalSensor.types";
import { collectCurrentValues, collectLiveValues, deviceHealth, wifiQuality } from "./currentValues";

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

describe("collectLiveValues", () => {
  const live: LiveTelemetry = {
    source: "redis",
    time: "2026-10-10T12:30:00Z",
    values: { dht22: { temperature: 23.4, relative_humidity: null } },
    health: {},
    presence: "online",
    sensors: page.sensors,
  };

  it("reads every described sensor variable from the single live state", () => {
    expect(collectLiveValues(live)).toEqual({
      values: [
        { id: "dht22:temperature", sensorName: "DHT22", variable: TEMPERATURE, value: 23.4 },
        { id: "dht22:relative_humidity", sensorName: "DHT22", variable: HUMIDITY, value: null },
        { id: "bmp280:temperature", sensorName: "BMP280", variable: TEMPERATURE, value: null },
      ],
      lastTime: "2026-10-10T12:30:00Z",
    });
  });

  it("has no last time without a reading and handles a missing state", () => {
    expect(collectLiveValues({ ...live, time: null, values: {}, sensors: [] })).toEqual({ values: [], lastTime: undefined });
    expect(collectLiveValues(undefined)).toEqual({ values: [], lastTime: undefined });
  });
});

describe("device health", () => {
  it("labels the WiFi signal strength", () => {
    expect(wifiQuality(-45)).toBe("Excelente");
    expect(wifiQuality(-50)).toBe("Excelente");
    expect(wifiQuality(-51)).toBe("Buena");
    expect(wifiQuality(-60)).toBe("Buena");
    expect(wifiQuality(-70)).toBe("Regular");
    expect(wifiQuality(-71)).toBe("Débil");
  });

  it("keeps only the usable WiFi RSSI and firmware version", () => {
    expect(deviceHealth({ wifi_rssi: -58, firmware_version: "1.4.2", uptime: 3600 })).toEqual({
      wifi: { rssi: -58, quality: "Buena" },
      firmware: "1.4.2",
    });
    expect(deviceHealth({ wifi_rssi: "bad", firmware_version: "" })).toEqual({});
    expect(deviceHealth(undefined)).toEqual({});
  });
});
