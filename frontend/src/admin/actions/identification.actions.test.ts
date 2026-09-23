import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";
import { getIdentificationTypesAction } from "./identification.actions";

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
  },
}));

describe("identification action read errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propagates a failed identification-type list request", async () => {
    const error = new Error("network unavailable");
    vi.mocked(appApi.get).mockRejectedValueOnce(error);

    await expect(getIdentificationTypesAction({})).rejects.toBe(error);
  });
});
