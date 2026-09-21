import { appApi } from "@/api/appApi";
import { toast } from "sonner";

interface ResetPasswordPayload {
  token: string;
  new_password: string;
  confirm_password: string;
}

export const resetPasswordAction = async (
  payload: ResetPasswordPayload
): Promise<{ success: boolean; message: string }> => {
  try {
    const { data } = await appApi.post<{ message: string }>(
      "/auth/reset-password",
      payload
    );
    return { success: true, message: data.message };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    toast.error("Error al restablecer contraseña, error: " + error);
    if (error.response && error.response.data) {
      return {
        success: false,
        message:
          error.response.data.detail || "Error al restablecer contraseña",
      };
    }
    return { success: false, message: "Error desconocido" };
  }
};
