import { describe, expect, it } from "vitest";

import type { Device } from "@/app/types/device.types";
import type { AggregateTelemetry } from "@/app/types/environmentalSensor.types";
import {
  bandKey,
  buildEnvironmentSeries,
  collectVariables,
  defaultVariableCode,
  latestPoints,
  listDeviceEnvironments,
  sensorLabel,
  seriesStroke,
  type DeviceAggregate,
} from "./environmentSeries";

const TEMPERATURE = { code: "temperature", name: "Temperatura", unit: "°C" };
const HUMIDITY = { code: "relative_humidity", name: "Humedad", unit: "%" };
const PRESSURE = { code: "pressure", name: "Presión", unit: "hPa" };

const at = (time: string) => Date.parse(`2026-10-10T${time}:00Z`);
const stat = (avg: number, min = avg, max = avg, count = 1) => ({ avg, min, max, count });

const north: AggregateTelemetry = {
  bucket: "5m",
  bucketSeconds: 300,
  start: "2026-10-10T12:00:00Z",
  end: "2026-10-10T13:00:00Z",
  // Ascending bucket starts, like the API.
  items: [
    { time: "2026-10-10T12:00:00Z", values: { dht22: { temperature: stat(21, 20, 22, 2) }, sht31: { relative_humidity: stat(40) } } },
    { time: "2026-10-10T12:05:00Z", values: { dht22: { temperature: stat(22) }, bmp280: { temperature: stat(21.5, 21, 22, 3) } } },
    { time: "2026-10-10T12:10:00Z", values: { dht22: { relative_humidity: stat(50) } } },
    { time: "2026-10-10T12:15:00Z", values: { dht22: { temperature: stat(24, 23, 25, 4) } } },
  ],
  sensors: [
    { key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [TEMPERATURE, HUMIDITY] },
    { key: "bmp280", sensorCode: "bmp280", sensorName: "BMP280", variables: [TEMPERATURE, PRESSURE] },
    { key: "sht31", sensorCode: "sht31", sensorName: "SHT31", variables: [HUMIDITY] },
  ],
};

const south: AggregateTelemetry = {
  ...north,
  items: [{ time: "2026-10-10T12:00:00Z", values: { dht22: { temperature: stat(18, 17, 19, 2) } } }],
  sensors: [{ key: "dht22", sensorCode: "dht22", sensorName: "DHT22", variables: [TEMPERATURE] }],
};

const aggregates: DeviceAggregate[] = [
  { deviceId: "north", deviceName: "Sensor Norte", data: north },
  { deviceId: "south", deviceName: "Sensor Sur", data: south },
  { deviceId: "pending", deviceName: "Sensor Oeste", data: undefined },
];

describe("buildEnvironmentSeries", () => {
  it("builds one labelled series per device sensor that measures the variable", () => {
    const { series } = buildEnvironmentSeries(aggregates, "temperature");

    expect(series).toEqual([
      { key: "s0", label: "Sensor Norte · DHT22", deviceId: "north", sensorKey: "dht22" },
      { key: "s1", label: "Sensor Norte · BMP280", deviceId: "north", sensorKey: "bmp280" },
      { key: "s2", label: "Sensor Sur · DHT22", deviceId: "south", sensorKey: "dht22" },
    ]);
  });

  it("plots the bucket averages by default, merged on the bucket starts in ascending order", () => {
    const { points } = buildEnvironmentSeries(aggregates, "temperature");

    expect(points.map((point) => [point.time, point.s0, point.s1, point.s2])).toEqual([
      [at("12:00"), 21, null, 18],
      [at("12:05"), 22, 21.5, null],
      [at("12:15"), 24, null, null],
    ]);
  });

  it("plots the chosen function: minimum or maximum of every bucket", () => {
    const minimum = buildEnvironmentSeries(aggregates, "temperature", { fn: "min" }).points;
    const maximum = buildEnvironmentSeries(aggregates, "temperature", { fn: "max" }).points;

    expect(minimum.map((point) => [point.s0, point.s1, point.s2])).toEqual([[20, null, 17], [22, 21, null], [23, null, null]]);
    expect(maximum.map((point) => [point.s0, point.s1, point.s2])).toEqual([[22, null, 19], [22, 22, null], [25, null, null]]);
  });

  it("carries the min–max band of every series next to its value", () => {
    const { points } = buildEnvironmentSeries(aggregates, "temperature");

    expect(points[0][bandKey("s0")]).toEqual([20, 22]);
    expect(points[0][bandKey("s1")]).toBeNull();
    expect(points[0][bandKey("s2")]).toEqual([17, 19]);
    expect(points[2][bandKey("s0")]).toEqual([23, 25]);
  });

  it("drops buckets where no series has a value", () => {
    const { points } = buildEnvironmentSeries(aggregates, "temperature");

    expect(points.some((point) => point.time === at("12:10"))).toBe(false);
  });

  it("labels series with the sensor name only when given the sensor label strategy", () => {
    const { series, points } = buildEnvironmentSeries(aggregates.slice(0, 1), "temperature", { label: sensorLabel });

    expect(series.map((entry) => entry.label)).toEqual(["DHT22", "BMP280"]);
    expect(points[1]).toMatchObject({ time: at("12:05"), s0: 22, s1: 21.5 });
  });

  it("drops the buckets that ended before the window start, keeping the series", () => {
    // The 12:00 bucket ends at 12:05: still partly inside a window that starts at 12:04.
    expect(buildEnvironmentSeries(aggregates, "temperature", { since: at("12:04") }).points.map((point) => point.time))
      .toEqual([at("12:00"), at("12:05"), at("12:15")]);
    const { series, points } = buildEnvironmentSeries(aggregates, "temperature", { since: at("12:05") });

    expect(series).toHaveLength(3);
    expect(points.map((point) => point.time)).toEqual([at("12:05"), at("12:15")]);
  });

  it("has no points once every bucket left the window", () => {
    const { series, points } = buildEnvironmentSeries(aggregates, "temperature", { since: at("13:00") });

    expect(series).toHaveLength(3);
    expect(points).toEqual([]);
  });

  it("returns no series or points for an unknown variable", () => {
    expect(buildEnvironmentSeries(aggregates, "co2")).toEqual({ series: [], points: [] });
  });
});

describe("latestPoints", () => {
  it("returns the newest buckets first, up to the limit", () => {
    const { points } = buildEnvironmentSeries(aggregates, "temperature");

    expect(latestPoints(points, 2).map((point) => point.time)).toEqual([at("12:15"), at("12:05")]);
    expect(latestPoints(points, 20)).toHaveLength(3);
    expect(points[0].time).toBe(at("12:00"));
  });
});

describe("collectVariables", () => {
  it("merges variables by code across devices and sensors", () => {
    expect(collectVariables(aggregates)).toEqual([TEMPERATURE, HUMIDITY, PRESSURE]);
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
