import { appApi } from "@/api/appApi";
import { toast } from "sonner";

export const forgotPasswordAction = async (email: string): Promise<boolean> => {
  try {
    await appApi.post("/auth/forgot-password", { email });
    return true;
  } catch (error) {
    toast.error("Error al enviar correo de recuperación, error: " + error);
    return false;
  }
};
