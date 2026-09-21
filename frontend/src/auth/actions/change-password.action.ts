import { appApi } from "@/api/appApi";
import type { UserPasswordUpdate } from "../interfaces/user-profile.interface";
import { isAxiosError } from "axios";

export const changePasswordAction = async (
  passwords: UserPasswordUpdate
): Promise<boolean> => {
  try {
    await appApi.patch("/auth/password", passwords);
    return true;
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.detail);
    }
    throw new Error("No se pudo actualizar la contraseña");
  }
};
