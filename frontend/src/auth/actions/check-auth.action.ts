import { appApi } from "@/api/appApi";
import { jwtDecode } from "jwt-decode";
import type { AuthResponse } from "../interfaces/auth.response";
import { withFullName } from "./session-user";

export const checkAuthAction = async (): Promise<AuthResponse> => {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("No hay ningún token");

  try {
    // 1. Verificar caducidad localmente para ahorrar una petición si ya expiró
    const decoded = jwtDecode<{ exp: number }>(token);
    const currentTime = Date.now() / 1000;

    if (decoded.exp < currentTime) {
      throw new Error("Token expirado localmente");
    }

    // 2. Verificar validez con el servidor (seguridad) y renovar si es necesario
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await appApi.get<any>("/auth/check-status");

    localStorage.setItem("token", data.access_token);

    return {
      ...data,
      token: data.access_token,
      user: withFullName(data.user),
    };
  } catch {
    localStorage.removeItem("token");
    throw new Error("Token expirado o no válido");
  }
};
