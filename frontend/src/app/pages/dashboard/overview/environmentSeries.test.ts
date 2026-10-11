import { describe, expect, it } from "vitest";

import type { Device } from "@/app/types/device.types";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import {
  BUCKET_MS,
  buildEnvironmentSeries,
  collectVariables,
  defaultVariableCode,
  latestPoints,
  listDeviceEnvironments,
  sensorLabel,
  seriesStroke,
  type DeviceHistory,
} from "./environmentSeries";

const TEMPERATURE = { code: "temperature", name: "Temperatura", unit: "°C" };
const HUMIDITY = { code: "relative_humidity", name: "Humedad", unit: "%" };
const PRESSURE = { code: "pressure", name: "Presión", unit: "hPa" };

const at = (time: string) => Date.parse(`2026-10-10T${time}:00Z`);

const north: TelemetryPage = {
  // Newest first, like the API.
  items: [
    { time: "2026-10-10T12:40:00Z", values: { dht22: { temperature: null }, bmp280: { temperature: null } } },
    { time: "2026-10-10T12:15:00Z", values: { dht22: { temperature: 24 } } },
    { time: "2026-10-10T12:12:00Z", values: { dht22: { temperature: null, relative_humidity: 50 } } },
    { time: "2026-10-10T12:05:00Z", values: { dht22: { temperature: 22 }, bmp280: { temperature: 21.5 } } },
    { time: "2026-10-10T12:01:00Z", values: { dht22: { temperature: 20 }, sht31: { relative_humidity: 40 } } },
  ],
  total: 5,
  sensors: [
    { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [TEMPERATURE, HUMIDITY] },
    { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [TEMPERATURE, PRESSURE] },
    { key: "sht31", sensorCode: "sht31", sensorName: "SHT31", variables: [HUMIDITY] },
  ],
};

const south: TelemetryPage = {
  items: [{ time: "2026-10-10T12:03:00Z", values: { dht22: { temperature: 18 } } }],
  total: 1,
  sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [TEMPERATURE] }],
};

const histories: DeviceHistory[] = [
  { deviceId: "north", deviceName: "Sensor Norte", page: north },
  { deviceId: "south", deviceName: "Sensor Sur", page: south },
  { deviceId: "pending", deviceName: "Sensor Oeste", page: undefined },
];

describe("buildEnvironmentSeries", () => {
  it("builds one labelled series per device sensor that measures the variable", () => {
    const { series } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["24h"]);

    expect(series).toEqual([
      { key: "s0", label: "Sensor Norte · DHT22", deviceId: "north", sensorKey: "dht22" },
      { key: "s1", label: "Sensor Norte · BMP280", deviceId: "north", sensorKey: "bmp280" },
      { key: "s2", label: "Sensor Sur · DHT22", deviceId: "south", sensorKey: "dht22" },
    ]);
  });

  it("averages non-null readings per time bucket in ascending order", () => {
    const { points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["24h"]);

    expect(points).toEqual([
      { time: at("12:00"), s0: 21, s1: 21.5, s2: 18 },
      { time: at("12:10"), s0: 24, s1: null, s2: null },
    ]);
  });

  it("drops buckets where no series has a value", () => {
    const { points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["24h"]);

    expect(points.some((point) => point.time === at("12:40"))).toBe(false);
  });

  it("keeps every reading apart with the one-minute bucket", () => {
    const { points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["1h"]);

    expect(points.map((point) => point.time)).toEqual([
      at("12:01"), at("12:03"), at("12:05"), at("12:15"),
    ]);
    expect(points[0]).toEqual({ time: at("12:01"), s0: 20, s1: null, s2: null });
  });

  it("labels series with the sensor name only when given the sensor label strategy", () => {
    const { series, points } = buildEnvironmentSeries(histories.slice(0, 1), "temperature", BUCKET_MS["24h"], { label: sensorLabel });

    expect(series.map((entry) => entry.label)).toEqual(["DHT22", "BMP280"]);
    expect(points[0]).toEqual({ time: at("12:00"), s0: 21, s1: 21.5 });
  });

  it("drops readings older than the window start, keeping the series", () => {
    const { series, points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["1h"], { since: at("12:04") });

    expect(series).toHaveLength(3);
    expect(points.map((point) => point.time)).toEqual([at("12:05"), at("12:15")]);
  });

  it("has no points once every reading left the window", () => {
    const { series, points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["1h"], { since: at("13:00") });

    expect(series).toHaveLength(3);
    expect(points).toEqual([]);
  });

  it("returns no series or points for an unknown variable", () => {
    expect(buildEnvironmentSeries(histories, "co2", BUCKET_MS["7d"])).toEqual({ series: [], points: [] });
  });
});

describe("latestPoints", () => {
  it("returns the newest buckets first, up to the limit", () => {
    const { points } = buildEnvironmentSeries(histories, "temperature", BUCKET_MS["1h"]);

    expect(latestPoints(points, 2).map((point) => point.time)).toEqual([at("12:15"), at("12:05")]);
    expect(latestPoints(points, 20)).toHaveLength(4);
    expect(points[0].time).toBe(at("12:01"));
  });
});

describe("collectVariables", () => {
  it("merges variables by code across devices and sensors", () => {
    expect(collectVariables(histories)).toEqual([TEMPERATURE, HUMIDITY, PRESSURE]);
  });

  it("prefers temperature as the default variable, else the first", () => {
    expect(defaultVariableCode([HUMIDITY, TEMPERATURE])).toBe("temperature");
    expect(defaultVariableCode([PRESSURE, HUMIDITY])).toBe("pressure");
    expect(defaultVariableCode([])).toBeUndefined();
  });
});

describe("seriesStroke", () => {
  it("cycles the chart tokens and adds a dash pattern after the fifth series", () => {
    expect(seriesStroke(0)).toEqual({ color: "var(--chart-1)" });
    expect(seriesStroke(4)).toEqual({ color: "var(--chart-5)" });
    expect(seriesStroke(5).color).toBe("var(--chart-1)");
    expect(seriesStroke(5).dash).toBeTruthy();
    expect(seriesStroke(10).dash).toBeTruthy();
    expect(seriesStroke(10).dash).not.toBe(seriesStroke(5).dash);
  });
});

describe("listDeviceEnvironments", () => {
  it("lists each establishment with loaded devices once, sorted by name", () => {
    const devices = [
      { id: "a", environment: { id: "env-2", name: "Sur" } },
      { id: "b" },
      { id: "c", environment: { id: "env-1", name: "Norte" } },
      { id: "d", environment: { id: "env-2", name: "Sur" } },
    ] as Device[];

    expect(listDeviceEnvironments(devices)).toEqual([
      { id: "env-1", name: "Norte" },
      { id: "env-2", name: "Sur" },
    ]);
  });
});
