import { appApi } from "@/api/appApi";
import type {
  EnvironmentType,
  EnvironmentTypeCreate,
  EnvironmentTypeListItem,
  EnvironmentTypeUpdate,
} from "@/interfaces/environment.interface";

interface GetEnvironmentTypesParams {
  page?: number;
  size?: number;
  per_page?: number;
  is_active?: boolean;
  search?: string;
  sort?: string;
}

interface GetEnvironmentTypesResponse {
  items: EnvironmentTypeListItem[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export const getEnvironmentTypesAction = async (
  params: GetEnvironmentTypesParams
): Promise<GetEnvironmentTypesResponse> => {
  const { page = 1, per_page = 10, is_active, search, sort } = params;
  const response = await appApi.get<GetEnvironmentTypesResponse>(
    "/environment/types/",
    {
      params: {
        page,
        per_page,
        is_active,
        search,
        sort,
      },
    }
  );
  return response.data;
};

export const getEnvironmentTypeAction = async (
  id: string
): Promise<EnvironmentType> => {
  const response = await appApi.get<EnvironmentType>(
    `/environment/types/${id}`
  );
  return response.data;
};

export const createEnvironmentTypeAction = async (
  data: EnvironmentTypeCreate
): Promise<EnvironmentType> => {
  const response = await appApi.post<EnvironmentType>(
    "/environment/types/",
    data
  );
  return response.data;
};

export const ensureEnvironmentTypeAction = async (
  name: string
): Promise<EnvironmentType> => {
  const response = await appApi.post<EnvironmentType>(
    "/environment/types/ensure",
    { name }
  );
  return response.data;
};

export const updateEnvironmentTypeAction = async ({
  id,
  data,
}: {
  id: string;
  data: EnvironmentTypeUpdate;
}): Promise<EnvironmentType> => {
  const response = await appApi.put<EnvironmentType>(
    `/environment/types/${id}`,
    data
  );
  return response.data;
};

export const deleteEnvironmentTypeAction = async (
  id: string
): Promise<void> => {
  await appApi.delete(`/environment/types/${id}`);
};
