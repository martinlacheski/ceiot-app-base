import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/api/appApi";
import { createUserAction, updateUserAction } from "./user.actions";

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
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
        firstName: "Test",
        lastName: "User",
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
        firstName: "Test",
        lastName: "User",
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

  it("sends only is_active when reactivating a user", async () => {
    await updateUserAction("user-1", { isActive: true });

    expect(appApi.put).toHaveBeenCalledWith("/auth/update/user-1", {
      is_active: true,
    });
  });

  it("does not send null for omitted fields in a partial update", async () => {
    await updateUserAction("user-1", { firstName: "Ada" });

    expect(appApi.put).toHaveBeenCalledWith("/auth/update/user-1", {
      first_name: "Ada",
    });
  });

  it("maps every provided full-form field to the backend contract", async () => {
    await updateUserAction("user-1", {
      email: "ada@example.com",
      username: "ada",
      firstName: "Ada",
      lastName: "Lovelace",
      identificationNumber: "12345678",
      birthDate: "",
      phone: "+54 351 555-0100",
      address: "",
      identificationTypeId: "document-type-1",
      cityId: "",
      isActive: false,
      isAdmin: true,
      permissions: ["user:me", "user:update"],
      password: "StrongPassword123!",
      confirmPassword: "StrongPassword123!",
    });

    expect(appApi.put).toHaveBeenCalledWith("/auth/update/user-1", {
      email: "ada@example.com",
      username: "ada",
      first_name: "Ada",
      last_name: "Lovelace",
      identification_number: "12345678",
      birth_date: null,
      phone: "+54 351 555-0100",
      address: null,
      identification_type_id: "document-type-1",
      city_id: null,
      is_active: false,
      is_admin: true,
      permissions: ["user:me", "user:update"],
      password: "StrongPassword123!",
    });
  });
});
