/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SessionUser } from "@/interfaces/user.interface";
import { create } from "zustand";

import { appApi } from "@/api/appApi";
import { loginAction } from "../actions/login.action";
import {
  checkEmailAction,
  checkIdentificationAction,
  checkUsernameAction,
  registerUserAction,
} from "../actions/register.action";

import { changePasswordAction } from "../actions/change-password.action";
import { forgotPasswordAction } from "../actions/forgot-password.action";
import { resetPasswordAction } from "../actions/reset-password.action";
import { updateUserAction } from "../actions/update-user.action";

type AuthStatus = "authenticated" | "not-authenticated" | "checking";

const normalizeUser = (user: any): SessionUser => {
  if (!user) return user;
  return {
    ...user,
    firstName: user.firstName || user.first_name || "",
    lastName: user.lastName || user.last_name || "",
    identificationNumber:
      user.identificationNumber || user.identification_number || "",
    birthDate: user.birthDate || user.birth_date || "",
    phone: user.phone || "",
    address: user.address || "",
    identificationTypeId:
      user.identificationTypeId || user.identification_type_id || undefined,
    cityId: user.cityId || user.city_id || undefined,
    isActive: user.isActive !== undefined ? user.isActive : user.is_active,
    isAdmin: user.isAdmin !== undefined ? user.isAdmin : user.is_admin,
  };
};

type ProfileUpdatePayload = {
  firstName: string;
  lastName: string;
  identificationNumber?: string;
  birthDate?: string;
  phone?: string;
  identificationTypeId?: string;
  cityId?: string;
  address?: string;
};

type AuthState = {
  // Properties
  user: SessionUser | null;
  token: string | null;
  authStatus: AuthStatus;

  // Getters
  isAdmin: () => boolean;

  // Actions
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: unknown }>;
  registerUser: (
    username: string,
    firstName: string,
    lastName: string,
    identificationNumber: string,
    email: string,
    password: string,
    phone?: string,
    birthDate?: Date,
  ) => Promise<boolean>;
  checkUsernameAvailability: (username: string) => Promise<boolean>;
  checkEmailAvailability: (email: string) => Promise<boolean>;
  checkIdentificationAvailability: (
    identificationNumber: string,
  ) => Promise<boolean>;
  logout: () => void;
  checkAuthStatus: () => Promise<boolean>;
  changePassword: (
    old_password: string | null,
    new_password: string,
    confirm_password: string,
  ) => Promise<{ success: boolean; message: string }>;
  resendVerificationEmail: (
    email: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateProfile: (profile: ProfileUpdatePayload) => Promise<boolean>;
  updateAccount: (
    email: string,
    username: string,
  ) => Promise<{ success: boolean; message: string }>;
  forgotPassword: (email: string) => Promise<boolean>;
  resetPassword: (
    token: string,
    new_password: string,
    confirm_password: string,
  ) => Promise<{ success: boolean; message: string }>;
  verifyResetToken: (token: string) => Promise<boolean>;
  loginWithToken: (token: string) => Promise<boolean>;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  // Implementación del Store
  user: null,
  token: null,
  authStatus: "checking",

  // Getters
  isAdmin: () => {
    return get().user?.isAdmin || false;
  },

  // Actions
  registerUser: async (
    username,
    firstName,
    lastName,
    identificationNumber,
    email,
    password,
    phone,
    birthDate,
  ) => {
    try {
      await registerUserAction(
        username,
        firstName,
        lastName,
        identificationNumber,
        email,
        password,
        phone,
        birthDate,
      );
      // set({ user, token, authStatus: "authenticated" });
      return true;
    } catch {
      set({ user: null, token: null, authStatus: "not-authenticated" });

      return false;
    }
  },

  checkUsernameAvailability: async (username: string) => {
    return await checkUsernameAction(username);
  },

  checkEmailAvailability: async (email: string) => {
    return await checkEmailAction(email);
  },

  checkIdentificationAvailability: async (identificationNumber: string) => {
    return await checkIdentificationAction(identificationNumber);
  },

  resendVerificationEmail: async (email: string) => {
    try {
      const { resendVerificationAction } =
        await import("../actions/resend-verification.action");
      return await resendVerificationAction(email);
    } catch (error: any) {
      if (error.response && error.response.data) {
        return {
          success: false,
          message: error.response.data.detail || "Error al reenviar correo",
        };
      }
      return { success: false, message: error.message || "Error desconocido" };
    }
  },

  login: async (email: string, password: string) => {
    try {
      const data = await loginAction(email, password);
      // Token stored in memory only
      set({
        user: normalizeUser(data.user),
        token: data.token,
        authStatus: "authenticated",
      });

      return { success: true };
    } catch (error) {
      set({ user: null, token: null, authStatus: "not-authenticated" });
      return { success: false, error };
    }
  },

  logout: () => {
    appApi.post("/auth/logout").catch(() => {}); // Fire and forget
    set({ user: null, token: null, authStatus: "not-authenticated" });
  },

  checkAuthStatus: async () => {
    try {
      // Call refresh endpoint to restore session from cookie
      const { data } = await appApi.post("/auth/refresh");
      set({
        user: normalizeUser(data.user),
        token: data.access_token,
        authStatus: "authenticated",
      });
      return true;
    } catch {
      set({
        user: null,
        token: null,
        authStatus: "not-authenticated",
      });

      return false;
    }
  },

  changePassword: async (old_password, new_password, confirm_password) => {
    try {
      await changePasswordAction({
        old_password: old_password || undefined,
        new_password,
        confirm_password,
      });
      return { success: true, message: "Contraseña actualizada correctamente" };
    } catch (error: any) {
      if (error.response && error.response.data) {
        return {
          success: false,
          message:
            error.response.data.detail || "Error al actualizar la contraseña",
        };
      }
      return { success: false, message: "La contraseña actual es incorrecta" };
    }
  },

  updateProfile: async (profile) => {
    const user = get().user;
    if (!user) return false;

    try {
      const updatedUser = await updateUserAction(user.id, profile);

      set({
        user: normalizeUser({ ...user, ...updatedUser }),
      });
      return true;
    } catch {
      return false;
    }
  },

  updateAccount: async (email: string, username: string) => {
    const user = get().user;
    if (!user)
      return { success: false, message: "No hay un usuario autenticado" };

    try {
      const updatedUser = await updateUserAction(user.id, {
        email,
        username,
      });
      set({
        user: normalizeUser({ ...user, ...updatedUser }),
      });
      return { success: true, message: "Cuenta actualizada correctamente" };
    } catch (error: any) {
      if (error.response && error.response.data) {
        return {
          success: false,
          message:
            error.response.data.detail || "Error al actualizar la cuenta",
        };
      }
      return { success: false, message: "Error al actualizar la cuenta" };
    }
  },

  forgotPassword: async (email: string) => {
    return await forgotPasswordAction(email);
  },

  resetPassword: async (token, new_password, confirm_password) => {
    return await resetPasswordAction({
      token,
      new_password,
      confirm_password,
    });
  },
  verifyResetToken: async (token: string) => {
    try {
      const { data } = await appApi.get(`/auth/verify-reset-token/${token}`);
      return data.valid;
    } catch {
      return false;
    }
  },

  loginWithToken: async (token: string) => {
    localStorage.setItem("token", token);
    return await get().checkAuthStatus();
  },
}));
