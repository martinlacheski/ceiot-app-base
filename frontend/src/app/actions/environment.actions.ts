import { environmentService } from "@/app/services/environment.service";
import type {
  EnvironmentCreate,
  EnvironmentFilters,
  EnvironmentUpdate,
} from "@/app/types/environment.types";

export const getEnvironmentsAction = async (filters: EnvironmentFilters) => {
  return await environmentService.getAll(filters);
};

export const getEnvironmentByIdAction = async (id: string) => {
  return await environmentService.getById(id);
};

export const createEnvironmentAction = async (data: EnvironmentCreate) => {
  return await environmentService.create(data);
};

export const updateEnvironmentAction = async (
  id: string,
  data: EnvironmentUpdate
) => {
  return await environmentService.update(id, data);
};

export const deleteEnvironmentAction = async (id: string) => {
  return await environmentService.delete(id);
};

export const getEnvironmentTypesAction = async () => {
  return await environmentService.getTypes();
};
