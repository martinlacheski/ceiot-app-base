import { appApi } from "@/api/appApi";
import { isAxiosError } from "axios";

export const resendVerificationAction = async (identifier: string) => {
  try {
    const { data } = await appApi.post("/auth/resend-verification", {
      identifier,
    });
    return { success: true, message: data.message };
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(
        error.response.data.detail || "Error al reenviar el correo"
      );
    }
    throw new Error("Error inesperado al reenviar el correo");
  }
};
