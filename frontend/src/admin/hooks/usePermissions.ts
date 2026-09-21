import { useQuery } from "@tanstack/react-query";
import { getPermissionsAction } from "../actions/permissions.actions";

export const usePermissions = () => {
  return useQuery({
    queryKey: ["permissions"],
    queryFn: getPermissionsAction,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
};
