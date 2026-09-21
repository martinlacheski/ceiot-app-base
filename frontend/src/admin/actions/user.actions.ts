/* eslint-disable @typescript-eslint/no-explicit-any */
import { appApi } from "@/api/appApi";
import type { User } from "@/interfaces/user.interface";

export interface UsersResponse {
  items: User[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface GetUsersParams {
  page?: number;
  size?: number;
  search?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  sort?: string;
}

type UserActionPayload = Partial<User> & {
  password?: string;
  confirmPassword?: string;
};

export const getUsersAction = async (
  params: GetUsersParams,
): Promise<UsersResponse> => {
  const { data } = await appApi.get<UsersResponse>("/auth/", {
    params: {
      page: params.page,
      per_page: params.size,
      search: params.search,
      is_active: params.isActive,
      is_admin: params.isAdmin,
      sort: params.sort,
    },
  });
  return data;
};

export const getUserByIdAction = async (id: string): Promise<User> => {
  const { data } = await appApi.get<User>(`/auth/${id}`);
  return data;
};

export const createUserAction = async (
  user: UserActionPayload,
): Promise<User> => {
  // Map camelCase to snake_case for backend
  const payload = {
    ...user,
    first_name: user.firstName,
    last_name: user.lastName,
    identification_number: user.identificationNumber,
    birth_date: user.birthDate || null,
    address: user.address || null,

    identification_type_id: user.identificationTypeId || null,
    city_id: user.cityId || null,

    is_active: user.isActive,
    is_admin: user.isAdmin,
  };

  // Remove camelCase properties to prevent sending mixed case
  delete (payload as any).firstName;
  delete (payload as any).lastName;
  delete (payload as any).identificationNumber;
  delete (payload as any).birthDate;
  delete (payload as any).identificationTypeId;
  delete (payload as any).cityId;
  delete (payload as any).isActive;
  delete (payload as any).isAdmin;
  // Remove confirmPassword as backend doesn't need it
  delete (payload as any).confirmPassword;

  const { data } = await appApi.post<User>("/auth/create", payload);
  return data;
};

export const updateUserAction = async (
  id: string,
  user: UserActionPayload,
): Promise<User> => {
  // Map camelCase to snake_case for backend
  const payload = {
    ...user,
    first_name: user.firstName,
    last_name: user.lastName,
    identification_number: user.identificationNumber,
    birth_date: user.birthDate || null,
    address: user.address || null,

    identification_type_id: user.identificationTypeId || null,
    city_id: user.cityId || null,

    is_active: user.isActive,
    is_admin: user.isAdmin,
  };

  // Remove camelCase properties to prevent sending mixed case
  delete (payload as any).firstName;
  delete (payload as any).lastName;
  delete (payload as any).identificationNumber;
  delete (payload as any).birthDate;
  delete (payload as any).identificationTypeId;
  delete (payload as any).cityId;
  delete (payload as any).isActive;
  delete (payload as any).isAdmin;

  const { data } = await appApi.put<User>(`/auth/update/${id}`, payload);
  return data;
};

export const deleteUserAction = async (id: string): Promise<void> => {
  await appApi.delete(`/auth/delete/${id}`);
};
export const checkUsernameAvailabilityAction = async (
  username: string,
): Promise<boolean> => {
  const { data } = await appApi.get<{ available: boolean }>(
    `/auth/check-username/${username}`,
  );
  return data.available;
};

export const checkEmailAvailabilityAction = async (
  email: string,
): Promise<boolean> => {
  const { data } = await appApi.get<{ available: boolean }>(
    `/auth/check-email/${email}`,
  );
  return data.available;
};

export const checkIdentificationAvailabilityAction = async (
  identificationNumber: string,
): Promise<boolean> => {
  const { data } = await appApi.get<{ available: boolean }>(
    `/auth/check-identification/${identificationNumber}`,
  );
  return data.available;
};

export interface PermissionItem {
  value: string;
  label: string;
}

export interface PermissionGroup {
  label: string;
  items: PermissionItem[];
}

export interface PermissionsResponse {
  groups: PermissionGroup[];
  basic_permissions: string[];
}

export const getPermissionsAction = async (): Promise<PermissionsResponse> => {
  const { data } = await appApi.get<PermissionsResponse>("/auth/permissions");
  return data;
};
