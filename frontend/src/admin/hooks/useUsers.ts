/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUserAction,
  deleteUserAction,
  getUserByIdAction,
  getUsersAction,
  updateUserAction,
  type GetUsersParams,
  type UserActionPayload,
} from "../actions/user.actions";

export const useUsers = (
  params: GetUsersParams,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () => getUsersAction(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: options?.enabled,
  });
};

export const useUser = (id: string) => {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => getUserByIdAction(id),
    enabled: !!id,
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUserAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, user }: { id: string; user: UserActionPayload }) =>
      updateUserAction(id, user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUserAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
};
