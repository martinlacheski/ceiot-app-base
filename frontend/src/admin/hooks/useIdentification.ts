import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createIdentificationTypeAction,
  deleteIdentificationTypeAction,
  getIdentificationTypeAction,
  getIdentificationTypesAction,
  updateIdentificationTypeAction,
} from "../actions/identification.actions";

export const useIdentificationTypes = (params: {
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) =>
  useQuery({
    queryKey: ["identificationTypes", params],
    queryFn: () => getIdentificationTypesAction(params),
  });

export const useIdentificationType = (id: string) =>
  useQuery({
    queryKey: ["identificationTypes", id],
    queryFn: () => getIdentificationTypeAction(id),
    enabled: Boolean(id),
  });

export const useCreateIdentificationType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createIdentificationTypeAction,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["identificationTypes"] }),
  });
};

export const useUpdateIdentificationType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateIdentificationTypeAction,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["identificationTypes"] }),
  });
};

export const useDeleteIdentificationType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteIdentificationTypeAction,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["identificationTypes"] }),
  });
};
