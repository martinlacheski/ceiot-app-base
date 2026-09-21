import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEnvironmentTypeAction,
  deleteEnvironmentTypeAction,
  getEnvironmentTypesAction,
  getEnvironmentTypeAction,
  updateEnvironmentTypeAction,
} from "../actions/environment.actions";

export const useEnvironmentTypes = (params: {
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) => {
  return useQuery({
    queryKey: ["environmentTypes", params],
    queryFn: () =>
      getEnvironmentTypesAction({
        page: params.page,
        per_page: params.size,
        is_active: params.isActive,
        search: params.search,
        sort: params.sort,
      }),
  });
};

export const useEnvironmentType = (id: string) => {
  return useQuery({
    queryKey: ["environmentTypes", id],
    queryFn: () => getEnvironmentTypeAction(id),
    enabled: !!id,
  });
};

export const useCreateEnvironmentType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEnvironmentTypeAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environmentTypes"] });
    },
  });
};

export const useUpdateEnvironmentType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateEnvironmentTypeAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environmentTypes"] });
    },
  });
};

export const useDeleteEnvironmentType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEnvironmentTypeAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environmentTypes"] });
    },
  });
};
