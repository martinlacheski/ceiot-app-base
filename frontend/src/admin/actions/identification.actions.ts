import { appApi } from "@/api/appApi";
import type {
  IdentificationTypeCreate,
  IdentificationTypeUpdate,
} from "@/interfaces/identification.interface";

export const getIdentificationTypesAction = async ({
  page = 1,
  size = 10,
  isActive,
  search,
  sort,
}: {
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) => {
  try {
    const response = await appApi.get("/tax/identification-types", {
      params: {
        page,
        per_page: size,
        is_active: isActive,
        search,
        sort,
      },
    });
    return response.data;
  } catch {
    return { items: [], total: 0, pages: 0 };
  }
};

export const getIdentificationTypeAction = async (id: string) => {
  const response = await appApi.get(`/tax/identification-types/${id}`);
  return response.data;
};

export const createIdentificationTypeAction = async (
  data: IdentificationTypeCreate
) => {
  const response = await appApi.post("/tax/identification-types/", data);
  return response.data;
};

export const updateIdentificationTypeAction = async ({
  id,
  data,
}: {
  id: string;
  data: IdentificationTypeUpdate;
}) => {
  const response = await appApi.put(`/tax/identification-types/${id}`, data);
  return response.data;
};

export const deleteIdentificationTypeAction = async (id: string) => {
  await appApi.delete(`/tax/identification-types/${id}`);
};
