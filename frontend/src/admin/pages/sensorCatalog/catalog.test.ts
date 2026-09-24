import { describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { catalogApi } from "./catalogApi";
import { validateSensorVariables } from "./catalogValidation";

vi.mock("@/api/appApi", () => ({ appApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

describe("admin sensor catalog", () => {
  it("uses paginated admin reads without changing legacy array reads", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { items: [], total: 0, page: 1, perPage: 10, pages: 0 } });
    await catalogApi.list("sensors", { page: 1, perPage: 10, search: "dht", isActive: false, sort: "code:asc" });
    expect(appApi.get).toHaveBeenCalledWith("/sensor-catalog/sensors", { params: { page: 1, per_page: 10, search: "dht", is_active: false, sort: "code:asc" } });
  });

  it("rejects duplicate variables and reversed ranges", () => {
    expect(validateSensorVariables([{ variableId: "a", minValue: 10, maxValue: 0, accuracy: "1", resolution: "1" }])).toBeTruthy();
    expect(validateSensorVariables([{ variableId: "a", minValue: 0, maxValue: 10, accuracy: "1", resolution: "1" }, { variableId: "a", minValue: 0, maxValue: 10, accuracy: "1", resolution: "1" }])).toBeTruthy();
    expect(validateSensorVariables([{ variableId: "a", minValue: -10, maxValue: 0, accuracy: "1", resolution: "1" }])).toBeNull();
  });
});
