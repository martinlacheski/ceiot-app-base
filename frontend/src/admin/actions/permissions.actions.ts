import { appApi } from "@/api/appApi";

export interface PermissionItem {
  value: string;
  label: string;
  is_basic?: boolean;
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
