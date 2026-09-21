import { describe, expect, it, vi, beforeEach } from "vitest";
import { appApi } from "@/api/appApi";
import { updateUserAction } from "./update-user.action";

vi.mock("@/api/appApi", () => ({
  appApi: {
    put: vi.fn(),
  },
}));

describe("updateUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appApi.put).mockResolvedValue({
      data: {
        id: "1",
        email: "test@example.com",
        username: "test",
        fullName: "Test User",
        permissions: [],
        isActive: true,
        isAdmin: false,
      },
    });
  });

  it("maps profile identity fields without fiscal data", async () => {
    await updateUserAction("user-1", {
      firstName: "Test",
      identificationTypeId: "dni",
    });
    expect(appApi.put).toHaveBeenCalledWith("/auth/update/user-1", {
      first_name: "Test",
      identification_type_id: "dni",
    });
  });
});
