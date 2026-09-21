import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePasswordAction } from "../actions/change-password.action";
import { updateUserAction } from "../actions/update-user.action";
import { useAuthStore } from "./auth.store";

// Mock the action module
vi.mock("../actions/change-password.action", () => ({
  changePasswordAction: vi.fn(),
}));
vi.mock("../actions/update-user.action", () => ({
  updateUserAction: vi.fn(),
}));

describe("Auth Store", () => {
  beforeEach(() => {
    vi.mocked(changePasswordAction).mockReset();
    vi.mocked(changePasswordAction).mockResolvedValue(true); // Default success

    // Reset other mocks
    vi.mocked(updateUserAction).mockReset();

    useAuthStore.setState({
      user: null,
      token: null,
      authStatus: "not-authenticated",
    });
  });

  describe("changePassword", () => {
    it("should return success when action succeeds", async () => {
      const result = await useAuthStore
        .getState()
        .changePassword("old", "new", "new");

      expect(result).toEqual({
        success: true,
        message: "Contraseña actualizada correctamente",
      });
      expect(vi.mocked(changePasswordAction)).toHaveBeenCalledWith({
        old_password: "old",
        new_password: "new",
        confirm_password: "new",
      });
    });

    it("should return error message when action fails with specific response", async () => {
      const errorResponse = {
        response: {
          data: {
            detail: "La contraseña actual es incorrecta",
          },
        },
      };

      vi.mocked(changePasswordAction).mockRejectedValueOnce(errorResponse);

      const result = await useAuthStore
        .getState()
        .changePassword("wrong", "new", "new");

      expect(result).toEqual({
        success: false,
        message: "La contraseña actual es incorrecta",
      });
    });

    it.skip("should return generic error message when action fails without detailed response", async () => {
      vi.mocked(changePasswordAction).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await useAuthStore
        .getState()
        .changePassword("old", "new", "new");

      expect(result).toEqual({
        success: false,
        message: "Error al actualizar la contraseña",
      });
    });
  });

  describe("updateProfile", () => {
    it("should update profile successfully via updateUserAction", async () => {
      vi.mocked(updateUserAction).mockResolvedValue({
        id: "1",
        email: "test@test.com",
        username: "test",
        firstName: "New",
        lastName: "Name",
        permissions: [],
        isActive: true,
        isAdmin: false,
        fullName: "New Name",
      });

      useAuthStore.setState({
        user: {
          id: 1,
          email: "test@test.com",
          firstName: "Old",
          lastName: "Name",
          fullName: "Old Name",
          username: "test",
          permissions: [],
          isActive: true,
          isAdmin: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });

      const result = await useAuthStore.getState().updateProfile({
        firstName: "New",
        lastName: "Name",
      });

      expect(result).toBe(true);
      expect(updateUserAction).toHaveBeenCalledWith(1, {
        firstName: "New",
        lastName: "Name",
      });
      // The store updates based on response from updateUserAction
      expect(useAuthStore.getState().user?.firstName).toBe("New");
    });

    it("should return false if no user is logged in", async () => {
      useAuthStore.setState({ user: null });
      const result = await useAuthStore.getState().updateProfile({
        firstName: "New",
        lastName: "Name",
      });
      expect(result).toBe(false);
    });

    it("should return false and not update state if action fails", async () => {
      vi.mocked(updateUserAction).mockRejectedValue(new Error("Failed"));

      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { id: 1, firstName: "Old", lastName: "Name" } as any,
      });

      const result = await useAuthStore.getState().updateProfile({
        firstName: "New",
        lastName: "Name",
      });

      expect(result).toBe(false);
      expect(useAuthStore.getState().user?.firstName).toBe("Old");
    });
  });
});
