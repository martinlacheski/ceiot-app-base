/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEnvironmentAction,
  deleteEnvironmentAction,
  getEnvironmentByIdAction,
  getEnvironmentsAction,
  updateEnvironmentAction,
  getEnvironmentTypesAction,
} from "../actions/environment.actions";
import type { EnvironmentFilters } from "../types/environment.types";

export const useEnvironments = (filters: EnvironmentFilters) => {
  return useQuery({
    queryKey: ["environments", filters],
    queryFn: () => getEnvironmentsAction(filters),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useEnvironment = (id: string) => {
  return useQuery({
    queryKey: ["environment", id],
    queryFn: () => getEnvironmentByIdAction(id),
    enabled: !!id,
  });
};

export const useCreateEnvironment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEnvironmentAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
};

export const useUpdateEnvironment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, environment }: { id: string; environment: any }) =>
      updateEnvironmentAction(id, environment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["environment"] });
    },
  });
};

export const useDeleteEnvironment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEnvironmentAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
};

export const useEnvironmentTypes = () => {
  return useQuery({
    queryKey: ["environment-types"],
    queryFn: () => getEnvironmentTypesAction(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
};
