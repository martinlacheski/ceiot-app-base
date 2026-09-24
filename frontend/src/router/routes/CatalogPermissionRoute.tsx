import type { PropsWithChildren } from "react";
import { Navigate } from "react-router";
import { useAuthStore } from "@/auth/store/auth.store";

export function CatalogPermissionRoute({ permission, children }: PropsWithChildren<{ permission: string }>) {
  const user = useAuthStore((state) => state.user);
  return user?.isAdmin && user.permissions?.includes(permission) ? children : <Navigate to="/admin/users" replace />;
}
