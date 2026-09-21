import { useAuthStore } from "@/auth/store/auth.store";
import { Logo } from "@/components/custom/Logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/utils";
import { getPasswordRequirements } from "@/utils/validators";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X as XIcon } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { TokenExpiredPage } from "./TokenExpiredPage";

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  /* State for form fields */
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const { resetPassword, verifyResetToken } = useAuthStore();

  const { isLoading: isCheckingToken, data: isTokenValid } = useQuery({
    queryKey: ["verifyResetToken", token],
    queryFn: () => verifyResetToken(token!),
    enabled: !!token,
    retry: false,
  });

  const {
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasLength: has8Characters,
  } = getPasswordRequirements(password);

  const isPasswordValid =
    hasUppercase && hasLowercase && hasNumber && has8Characters;

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token || !isPasswordValid || password !== confirmPassword) {
      return;
    }

    setIsPosting(true);
    const { success, message } = await resetPassword(
      token,
      password,
      confirmPassword
    );
    setIsPosting(false);

    if (success) {
      setShowSuccessDialog(true);
    } else {
      toast.error(message);
    }
  };

  const handleSuccessConfirm = () => {
    navigate("/auth/login");
  };

  if (!token) return <Navigate to="/auth/login" replace />;

  if (isCheckingToken) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isTokenValid) {
    return <TokenExpiredPage />;
  }

  return (
    <div className={"flex flex-col gap-6 max-w-md w-full mx-auto"}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-1">
          <form className="p-6 md:p-8" onSubmit={handleResetPassword}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <Logo />
                <h1 className="text-2xl font-bold">Restablecer contraseña</h1>
                <p className="text-balance text-muted-foreground">
                  Ingresa tu nueva contraseña
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Nueva contraseña</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingresa tu nueva contraseña"
                  />
                </div>

                {password.length > 0 && (
                  <div className="flex flex-col gap-1 text-sm text-destructive font-medium mt-1">
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        hasUppercase
                          ? "text-green-600"
                          : "text-muted-foreground"
                      )}
                    >
                      {hasUppercase ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <XIcon className="h-3 w-3" />
                      )}{" "}
                      1 Mayúscula
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        hasLowercase
                          ? "text-green-600"
                          : "text-muted-foreground"
                      )}
                    >
                      {hasLowercase ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <XIcon className="h-3 w-3" />
                      )}{" "}
                      1 Minúscula
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        hasNumber ? "text-green-600" : "text-muted-foreground"
                      )}
                    >
                      {hasNumber ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <XIcon className="h-3 w-3" />
                      )}{" "}
                      1 Número
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        has8Characters
                          ? "text-green-600"
                          : "text-muted-foreground"
                      )}
                    >
                      {has8Characters ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <XIcon className="h-3 w-3" />
                      )}{" "}
                      8 Caracteres
                    </span>
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirma tu nueva contraseña"
                />
                {confirmPassword && password !== confirmPassword && (
                  <span className="text-red-500 text-xs">
                    Las contraseñas no coinciden
                  </span>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                </Button>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  isPosting || !isPasswordValid || password !== confirmPassword
                }
              >
                {isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Restablecer contraseña
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Contraseña actualizada</AlertDialogTitle>
            <AlertDialogDescription>
              La contraseña ha sido actualizada correctamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleSuccessConfirm}>
              Ir a iniciar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
