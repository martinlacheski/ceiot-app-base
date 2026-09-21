import { appApi } from "@/api/appApi";
import type { AuthResponse } from "../interfaces/auth.response";

interface RegisterError {
  response?: {
    data?: {
      message?: string;
    };
  };
}

export const registerUserAction = async (
  username: string,
  firstName: string,
  lastName: string,
  identificationNumber: string,
  email: string,
  password: string,
  phone?: string,
  birthDate?: Date
): Promise<AuthResponse> => {
  try {
    const { data } = await appApi.post<AuthResponse>("/auth/register", {
      username,
      first_name: firstName,
      last_name: lastName,
      identification_number: identificationNumber,
      email,
      password,
      phone,
      birth_date: birthDate ? birthDate.toISOString().split("T")[0] : null,
    });

    return data;
  } catch (error) {
    throw new Error(
      (error as RegisterError).response?.data?.message || "Error al registrarse"
    );
  }
};

export const checkUsernameAction = async (
  username: string
): Promise<boolean> => {
  try {
    const { data } = await appApi.get<{ available: boolean }>(
      `/auth/check-username/${username}`
    );
    return data.available;
  } catch {
    return false;
  }
};

export const checkEmailAction = async (email: string): Promise<boolean> => {
  try {
    const { data } = await appApi.get<{ available: boolean }>(
      `/auth/check-email/${email}`
    );
    return data.available;
  } catch {
    return false;
  }
};

export const checkIdentificationAction = async (
  identificationNumber: string
): Promise<boolean> => {
  try {
    const { data } = await appApi.get<{ available: boolean }>(
      `/auth/check-identification/${identificationNumber}`
    );
    return data.available;
  } catch {
    return false;
  }
};
