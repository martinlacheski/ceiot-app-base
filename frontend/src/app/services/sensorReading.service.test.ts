import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";

import { sensorReadingService } from "./sensorReading.service";

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const response = {
  items: [
    {
      id: "reading-1",
      time: "2026-09-21T12:30:00Z",
      deviceId: "device-1",
      deviceSerial: "IOT-0000-0001",
      deviceType: "environmental",
      temperatureC: 24.5,
      relativeHumidityPct: 61,
      pressureHpa: 1013.2,
    },
  ],
  total: 1,
};

describe("sensorReadingService.getLatest", () => {
  it("requests the latest device readings with an optional limit", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: response });

    const result = await sensorReadingService.getLatest("device-1", 1);

    expect(appApi.get).toHaveBeenCalledTimes(1);
    expect(appApi.get).toHaveBeenCalledWith(
      "/devices/device-1/sensor-readings/latest",
      { params: expect.any(URLSearchParams) },
    );
    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(config.params.get("limit")).toBe("1");
    expect(result).toBe(response);
  });

  it("omits limit when none is provided", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: response });

    await sensorReadingService.getLatest("device-1");

    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(config.params.has("limit")).toBe(false);
  });
});

describe("sensorReadingService.getHistory", () => {
  it("requests a bounded history and preserves the camelCase response", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: response });
    const start = "2026-09-20T12:30:00.000Z";
    const end = "2026-09-21T12:30:00.000Z";

    const result = await sensorReadingService.getHistory(
      "device-1",
      start,
      end,
    );

    expect(appApi.get).toHaveBeenCalledWith(
      "/devices/device-1/sensor-readings/history",
      { params: expect.any(URLSearchParams) },
    );
    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(Object.fromEntries(config.params)).toEqual({ start, end });
    expect(result).toBe(response);
    expect(result.items[0]).toMatchObject({
      time: "2026-09-21T12:30:00Z",
      temperatureC: 24.5,
      relativeHumidityPct: 61,
      pressureHpa: 1013.2,
      deviceId: "device-1",
    });
  });
});
