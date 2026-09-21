import { useAuthStore } from "@/auth/store/auth.store";
import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router";

export const AuthenticatedRoute = ({ children }: PropsWithChildren) => {
  const { authStatus } = useAuthStore();
  const location = useLocation();

  if (authStatus === "checking") return null;

  if (authStatus === "not-authenticated")
    return <Navigate to="/auth/login" state={{ from: location }} replace />;

  return children;
};

export const NotAuthenticatedRoute = ({ children }: PropsWithChildren) => {
  const { authStatus } = useAuthStore();
  if (authStatus === "checking") return null;

  if (authStatus === "authenticated") return <Navigate to="/app" replace />;

  return children;
};

export const AdminRoute = ({ children }: PropsWithChildren) => {
  const { authStatus, isAdmin } = useAuthStore();

  if (authStatus === "checking") return null;

  if (authStatus === "not-authenticated") return <Navigate to="/auth/login" />;

  if (!isAdmin()) return <Navigate to="/app" />;

  return children;
};
