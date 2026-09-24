import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { environmentalSensorService } from "./environmentalSensor.service";

vi.mock("@/api/appApi", () => ({ appApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("environmentalSensorService", () => {
  it("reads catalog models and installed sensors", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: [] });
    await environmentalSensorService.getCatalog();
    await environmentalSensorService.getDeviceSensors("device-1");
    expect(appApi.get).toHaveBeenNthCalledWith(1, "/sensor-catalog/sensors");
    expect(appApi.get).toHaveBeenNthCalledWith(2, "/devices/device-1/sensors");
  });

  it("creates with a server-derived key and updates or deactivates by id", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: {} });
    vi.mocked(appApi.patch).mockResolvedValue({ data: {} });
    vi.mocked(appApi.delete).mockResolvedValue({ data: {} });
    await environmentalSensorService.addDeviceSensor("device-1", { sensorId: "dht22", config: {} });
    await environmentalSensorService.updateDeviceSensor("device-1", "installed-1", { key: "outdoor", config: { offset: 1 } });
    await environmentalSensorService.removeDeviceSensor("device-1", "installed-1");
    expect(appApi.post).toHaveBeenCalledWith("/devices/device-1/sensors", { sensorId: "dht22", config: {} });
    expect(appApi.patch).toHaveBeenCalledWith("/devices/device-1/sensors/installed-1", { key: "outdoor", config: { offset: 1 } });
    expect(appApi.delete).toHaveBeenCalledWith("/devices/device-1/sensors/installed-1");
  });

  it("requests bounded JSONB telemetry with pagination", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { items: [], total: 0, sensors: [] } });
    await environmentalSensorService.getLatest("device-1", 1);
    await environmentalSensorService.getHistory("device-1", "start", "end", 2, 500);
    expect(appApi.get).toHaveBeenNthCalledWith(1, "/devices/device-1/telemetry/latest", { params: expect.any(URLSearchParams) });
    expect(appApi.get).toHaveBeenNthCalledWith(2, "/devices/device-1/telemetry/history", { params: expect.any(URLSearchParams) });
    expect(Object.fromEntries((vi.mocked(appApi.get).mock.calls[0][1] as {params: URLSearchParams}).params)).toEqual({ limit: "1" });
    expect(Object.fromEntries((vi.mocked(appApi.get).mock.calls[1][1] as {params: URLSearchParams}).params)).toEqual({ start: "start", end: "end", page: "2", per_page: "500" });
  });
});
