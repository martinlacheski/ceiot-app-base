import { appApi } from "@/api/appApi";
import type { AuthResponse } from "../interfaces/auth.response";
import { withFullName } from "./session-user";

export const loginAction = async (
  username: string,
  password: string
): Promise<AuthResponse> => {
  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await appApi.post<any>("/auth/login", formData);

  return {
    ...data,
    token: data.access_token,
    user: withFullName(data.user),
  };
};
