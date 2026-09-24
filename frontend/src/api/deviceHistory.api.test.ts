import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/appApi", () => ({ appApi: { get } }));

import { deviceHistoryApi } from "./deviceHistory.api";

describe("deviceHistoryApi", () => {
  beforeEach(() => get.mockReset());

  it("requests a former-device page with snapshot identity and local date offset", async () => {
    get.mockResolvedValue({ data: { items: [], total: 0, page: 1, perPage: 10, pages: 0 } });
    await deviceHistoryApi.devices({ environmentId: "env-1", lastSeenFrom: "2026-09-01", page: 1, perPage: 10 });
    expect(get).toHaveBeenCalledWith("/devices/history/devices", {
      params: expect.objectContaining({ environment_id: "env-1", only_former: true, last_seen_from: "2026-09-01", utc_offset_minutes: -new Date().getTimezoneOffset() }),
    });
  });

  it("sends operation type and status without payment parameters", async () => {
    get.mockResolvedValue({ data: { items: [], total: 0, page: 1, perPage: 10, pages: 0 } });
    await deviceHistoryApi.operations("SN-1", { environmentId: "env-2", operationType: "SENSOR_DATA", status: "success", page: 1, perPage: 10 });
    const [, request] = get.mock.calls[0];
    expect(request.params).toMatchObject({ environment_id: "env-2", operation_type: "SENSOR_DATA", status: "success" });
    expect(Object.keys(request.params).join(" ")).not.toMatch(/payment|amount|revenue/);
  });

  it("requests JSONB telemetry with scoped variable filters and local dates", async () => {
    get.mockResolvedValue({ data: { items: [], sensors: [], total: 0, page: 1, perPage: 10, pages: 0 } });
    await deviceHistoryApi.telemetry("SN/1", { environmentId: "env-1", dateFrom: "2026-09-01", variable: "temperature", min: 20, max: 30, sortBy: "time", sortOrder: "asc", page: 1, perPage: 10 });
    expect(get).toHaveBeenCalledWith("/devices/history/devices/SN%2F1/telemetry", { params: expect.objectContaining({ environment_id: "env-1", date_from: "2026-09-01", variable: "temperature", min: 20, max: 30, sort_by: "time", sort_order: "asc", utc_offset_minutes: -new Date().getTimezoneOffset() }) });
  });

  it("fetches the catalog variables for complete history filter choices", async () => {
    get.mockResolvedValue({ data: [{ id: "v-pressure", code: "pressure", name: "Presión", unit: "hPa" }] });
    expect(await deviceHistoryApi.variables()).toEqual([{ id: "v-pressure", code: "pressure", name: "Presión", unit: "hPa" }]);
    expect(get).toHaveBeenCalledWith("/sensor-catalog/variables");
  });

  it("sends inclusive local date bounds to the operations endpoint", async () => {
    get.mockResolvedValue({ data: { items: [], total: 0, page: 1, perPage: 10, pages: 0 } });
    const dates = { dateFrom: "2026-09-01", dateTo: "2026-09-02" };
    await deviceHistoryApi.operations("SN-1", { environmentId: "env-1", ...dates });
    for (const [, request] of get.mock.calls) {
      expect(request.params).toMatchObject({ date_from: dates.dateFrom, date_to: dates.dateTo, utc_offset_minutes: -new Date().getTimezoneOffset() });
    }
  });
});
