import { Navigate, useSearchParams } from "react-router";
import { useAuthStore } from "@/auth/store/auth.store";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export const SocialCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const checkAuthStatus = useAuthStore((state) => state.checkAuthStatus);
  const error = searchParams.get("error");
  const nextPath = searchParams.get("next");
  const returnPath = nextPath || window.sessionStorage.getItem("auth:returnTo");

  const { data: success, isLoading } = useQuery({
    queryKey: ["social_callback"],
    queryFn: checkAuthStatus,
    retry: false,
    enabled: !error,
  });

  if (error) {
    return <Navigate to="/auth/login?error=social_auth_failed" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-100">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        <h2 className="text-xl font-semibold text-neutral-700">
          Iniciando sesión...
        </h2>
        <p className="text-neutral-500">
          Por favor espere mientras verificamos sus datos.
        </p>
      </div>
    );
  }

  if (success) {
    if (returnPath) {
      window.sessionStorage.removeItem("auth:returnTo");
      return <Navigate to={returnPath} replace />;
    }

    return <Navigate to="/app" replace />;
  }

  return <Navigate to="/auth/login?error=session_init_failed" replace />;
};
