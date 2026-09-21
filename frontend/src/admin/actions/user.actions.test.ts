import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { createUserAction, updateUserAction } from "./user.actions";

vi.mock("@/api/appApi", () => ({
  appApi: {
    post: vi.fn(),
    put: vi.fn(),
  },
}));

describe("admin user actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(appApi.post).mockResolvedValue({
      data: {
        id: "user-1",
        email: "test@example.com",
        username: "test",
        fullName: "Test User",
        permissions: [],
        isActive: true,
        isAdmin: false,
      },
    });

    vi.mocked(appApi.put).mockResolvedValue({
      data: {
        id: "user-1",
        email: "test@example.com",
        username: "test",
        fullName: "Test User",
        permissions: [],
        isActive: true,
        isAdmin: false,
      },
    });
  });

  it("envía address junto con city_id al crear", async () => {
    await createUserAction({
      firstName: "Ada",
      cityId: "city-1",
      address: "Av. Siempre Viva 742",
    });

    expect(appApi.post).toHaveBeenCalledWith(
      "/auth/create",
      expect.objectContaining({
        first_name: "Ada",
        city_id: "city-1",
        address: "Av. Siempre Viva 742",
      }),
    );
  });

  it("normaliza address vacío a null al editar", async () => {
    await updateUserAction("user-1", {
      cityId: "",
      address: "",
    });

    expect(appApi.put).toHaveBeenCalledWith(
      "/auth/update/user-1",
      expect.objectContaining({
        city_id: null,
        address: null,
      }),
    );
  });
});
