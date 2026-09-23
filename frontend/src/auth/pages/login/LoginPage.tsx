import { useRef, useState, type FormEvent } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
  useLocation,
} from "react-router";
import { toast } from "sonner";

import { Logo } from "@/components/custom/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { appApi } from "@/api/appApi";
import { API_BASE_URL } from "@/lib/apiBaseUrl";
import { Label } from "@/components/ui/label";

import { useAuthStore } from "@/auth/store/auth.store";
import { showConfirmDialog, showInfoDialog } from "@/store/confirm.store";
import { useQuery } from "@tanstack/react-query";
import { ForgotPasswordDialog } from "../../components/ForgotPasswordDialog";
import { AuthConsentNotice } from "@/auth/components/AuthConsentNotice";

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithToken } = useAuthStore();
  const [searchParams] = useSearchParams();

  const token = searchParams.get("token");
  const socialError = searchParams.get("error");
  const nextPath = searchParams.get("next");
  const storedReturnPath = window.sessionStorage.getItem("auth:returnTo");
  const returnPath = nextPath || storedReturnPath;

  const { data: isTokenValid } = useQuery({
    queryKey: ["loginWithToken", token],
    queryFn: () => loginWithToken(token!),
    enabled: !!token,
    retry: false,
  });

  const errorMessage = socialError
    ? "Error al iniciar sesión con red social"
    : token && isTokenValid === false
    ? "Error al validar la sesión"
    : null;

  const googleCheckPendingRef = useRef(false);
  const [isGoogleCheckPending, setIsGoogleCheckPending] = useState(false);

  const handleGoogleLogin = async () => {
    if (googleCheckPendingRef.current) return;

    googleCheckPendingRef.current = true;
    setIsGoogleCheckPending(true);
    try {
      const response = await appApi.get("/auth/providers");
      const googleCapability = response?.data?.google;

      if (googleCapability === true) {
        if (returnPath) {
          window.sessionStorage.setItem("auth:returnTo", returnPath);
        }
        const nextQuery = returnPath
          ? `?next=${encodeURIComponent(returnPath)}`
          : "";
        window.location.assign(`${API_BASE_URL}/auth/google/login${nextQuery}`);
        return;
      }

      if (googleCapability === false) {
        showInfoDialog(
          "Acceso con Google",
          "Esta opción todavía no está configurada. Por ahora, ingresá con tu usuario y contraseña.",
        );
        return;
      }

      showInfoDialog(
        "No se pudo verificar Google",
        "No pudimos verificar si el acceso con Google está disponible. Intentá nuevamente más tarde o consultá con el operador de la aplicación.",
      );
    } catch {
      showInfoDialog(
        "No se pudo verificar Google",
        "No pudimos verificar si el acceso con Google está disponible. Intentá nuevamente más tarde o consultá con el operador de la aplicación.",
      );
    } finally {
      googleCheckPendingRef.current = false;
      setIsGoogleCheckPending(false);
    }
  };

  const [isPosting, setIsPosting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsPosting(true);

    const formData = new FormData(event.target as HTMLFormElement);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    const { success, error } = await login(username, password);

    if (success) {
      if (returnPath) {
        window.sessionStorage.removeItem("auth:returnTo");
        navigate(returnPath, { replace: true });
        return;
      }

      // Check if there's a redirect location in state
      const state = location.state as {
        from?: { pathname: string; search: string };
      } | null;
      const from = state?.from?.pathname || "/app";
      const search = state?.from?.search || "";
      navigate(`${from}${search}`, { replace: true });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any)?.response?.status === 403) {
      showConfirmDialog(
        "Tu cuenta no está verificada. ¿Deseas reenviar el correo de verificación?",
        async () => {
          const { success, message } = await useAuthStore
            .getState()
            .resendVerificationEmail(username);

          if (success) {
            toast.success(
              "Correo de verificación reenviado. Revisa tu bandeja de entrada."
            );
          } else {
            toast.error(message || "Error al reenviar correo.");
          }
        }
      );
      setIsPosting(false);
      return;
    }

    toast.error("Usuario o contraseña no válidos");
    setIsPosting(false);
  };

  if (isTokenValid) {
    if (returnPath) {
      window.sessionStorage.removeItem("auth:returnTo");
      return <Navigate to={returnPath} replace />;
    }

    return <Navigate to="/app" replace />;
  }

  const registerHref = returnPath
    ? `/auth/register?next=${encodeURIComponent(returnPath)}`
    : "/auth/register";

  return (
    <div className={"flex flex-col gap-6 max-w-md w-full mx-auto"}>
      <Card className="overflow-hidden p-0  ">
        <CardContent className="grid p-0 md:grid-cols-1">
          <form className="p-6 md:p-8" onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <h1 className="mb-4 text-xl font-bold text-balance md:text-2xl">
                  Monitoreo Ambiental IoT
                </h1>
                <Logo size="large" />
                {errorMessage && (
                  <div className="w-full p-3 mb-4 text-sm text-red-500 bg-red-100 rounded-md dark:bg-red-900/30 dark:text-red-400">
                    {errorMessage}
                  </div>
                )}
                <p className="text-balance text-muted-foreground mt-2">
                  Ingrese a nuestra aplicación
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  type="text"
                  name="username"
                  placeholder="Ingrese su nombre de usuario"
                  required
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Contraseña</Label>
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  required
                  placeholder="Ingrese su contraseña"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-xs text-muted-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                </Button>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setForgotPasswordOpen(true);
                  }}
                  className="ml-auto text-sm underline-offset-2 hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
              <Button type="submit" className="w-full" disabled={isPosting}>
                Ingresar
              </Button>

              <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
                <span className="relative z-10 bg-background px-2 text-muted-foreground">
                  O ingresa con
                </span>
              </div>
              {/* <div className="grid grid-cols-2 gap-4"> */}
              <div className="grid grid-cols-1 gap-4">
                <Button
                  variant="outline"
                  className="w-full"
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isGoogleCheckPending}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
                    />
                  </svg>{" "}
                  Google
                </Button>
                {/* <Button
                  variant="outline"
                  className="w-full"
                  type="button"
                  onClick={() => handleSocialLogin("facebook")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
                      fill="currentColor"
                    />
                  </svg>
                  Meta
                </Button> */}
              </div>
              <div className="text-center text-sm">
                ¿No tienes cuenta?{" "}
                <Link
                  to={registerHref}
                  className="underline underline-offset-4"
                >
                  Crea una
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <AuthConsentNotice />
      <ForgotPasswordDialog
        open={forgotPasswordOpen}
        onOpenChange={setForgotPasswordOpen}
      />
    </div>
  );
};
