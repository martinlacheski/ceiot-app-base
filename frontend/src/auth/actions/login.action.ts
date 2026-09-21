import { appApi } from "@/api/appApi";
import type { AuthResponse } from "../interfaces/auth.response";

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
    user: {
      ...data.user,
      firstName: data.first_name,
      lastName: data.last_name,
      fullName:
        data.first_name && data.last_name
          ? `${data.first_name} ${data.last_name}`
          : undefined,
      identificationNumber: data.identification_number,
      birthDate: data.birth_date,
      phone: data.phone,
    },
  };
};
