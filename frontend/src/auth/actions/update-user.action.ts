import { appApi } from "@/api/appApi";
import type { User } from "@/interfaces/user.interface";

interface UpdateUserPayload {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  identificationNumber?: string;
  birthDate?: string;
  phone?: string;
  identificationTypeId?: string;
  cityId?: string;
  address?: string;
}

export const updateUserAction = async (
  id: string,
  updates: UpdateUserPayload,
): Promise<User> => {
  const payload: Record<string, string | null> = {};

  if (updates.email !== undefined) payload.email = updates.email;
  if (updates.username !== undefined) payload.username = updates.username;
  if (updates.firstName !== undefined) payload.first_name = updates.firstName;
  if (updates.lastName !== undefined) payload.last_name = updates.lastName;
  if (updates.identificationNumber !== undefined) {
    payload.identification_number = updates.identificationNumber;
  }
  if (updates.birthDate !== undefined) {
    payload.birth_date = updates.birthDate || null;
  }
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.identificationTypeId !== undefined) {
    payload.identification_type_id = updates.identificationTypeId || null;
  }
  if (updates.cityId !== undefined) payload.city_id = updates.cityId || null;
  if (updates.address !== undefined) payload.address = updates.address || null;

  const { data } = await appApi.put<User>(`/auth/update/${id}`, payload);
  return data;
};
