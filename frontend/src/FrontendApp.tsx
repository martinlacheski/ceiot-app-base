import { type PropsWithChildren } from "react";
import { RouterProvider } from "react-router";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
// import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";

import { useAuthStore } from "./auth/store/auth.store";
import { ConfirmDialog } from "./components/custom/ConfirmDialog";
import { FullScreenLoading } from "./components/custom/FullScreenLoading";
import { useIdle } from "./hooks/useIdle";
import { appRouter } from "./router/app.router";

const queryClient = new QueryClient();

const CheckAuthProvider = ({ children }: PropsWithChildren) => {
  const { checkAuthStatus, logout, user, authStatus } = useAuthStore();

  const handleIdle = () => {
    if (user) {
      logout();
      window.location.href = "/auth/login";
    }
  };

  // Idle timeout from environment variable (in minutes)
  const isIdle = useIdle({
    timeout: Number(import.meta.env.VITE_SESSION_TIMEOUT || 30) * 60 * 1000,
    onIdle: handleIdle,
  });

  const { isLoading } = useQuery({
    queryKey: ["auth"],
    queryFn: checkAuthStatus,
    retry: false,
    refetchInterval:
      isIdle || authStatus !== "authenticated"
        ? false
        : Number(import.meta.env.VITE_TOKEN_REFRESH || 90) * 1000,
    refetchOnWindowFocus: !isIdle && authStatus === "authenticated",
    enabled: !isIdle,
  });

  if (isLoading) return <FullScreenLoading />;

  return children;
};

export const FrontendApp = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster richColors position="bottom-right" />
      <ConfirmDialog />

      {/* Auth Provider */}
      <CheckAuthProvider>
        <RouterProvider router={appRouter} />
      </CheckAuthProvider>

      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  );
};
