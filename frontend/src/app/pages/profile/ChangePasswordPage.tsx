import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FULL_PAGE_FORM_ACTION_BUTTON_CLASS,
  FULL_PAGE_FORM_ACTIONS_CLASS,
  FULL_PAGE_FORM_BACK_LABEL,
  FULL_PAGE_FORM_SAVE_LABEL,
} from "@/components/custom/fullPageFormActions";
import { showConfirmDialog } from "@/store/confirm.store";
import { cn } from "@/utils/utils";
import { getPasswordRequirements } from "@/utils/validators";
import { Check, X as XIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const { changePassword, user } = useAuthStore();
  const isSocialAuth = user?.isSocialAuth || false;

  const [showPassword, setShowPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const pwdReqs = getPasswordRequirements(newPassword);
  const allReqsMet = Object.values(pwdReqs).every(Boolean);

  const handleSavePassword = async () => {
    // Only require old password for non-OAuth users
    if (!isSocialAuth && !oldPassword) {
      setPasswordError("Debes ingresar tu contraseña actual");
      return;
    }
    if (!isSocialAuth && newPassword === oldPassword) {
      setPasswordError("La nueva contraseña no puede ser igual a la actual");
      return;
    }
    if (!allReqsMet) {
      setPasswordError("La contraseña no cumple con los requisitos");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las contraseñas no coinciden");
      return;
    }
    setPasswordError("");

    showConfirmDialog("¿Estás seguro de cambiar la contraseña?", async () => {
      const { success, message } = await changePassword(
        isSocialAuth ? null : oldPassword,
        newPassword,
        confirmPassword
      );
      if (success) {
        toast.success(message);
        setNewPassword("");
        setOldPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        navigate(-1);
      } else {
        setPasswordError(message);
        toast.error(message);
      }
    });
  };

  const handleConfirmPasswordChange = (val: string) => {
    setConfirmPassword(val);
    // Verificar si las contraseñas coinciden
    if (passwordError === "Las contraseñas no coinciden") {
      setPasswordError("");
    }
  };

  const handleNewPasswordChange = (val: string) => {
    setNewPassword(val);
    if (
      passwordError === "Las contraseñas no coinciden" &&
      val === confirmPassword
    ) {
      setPasswordError("");
    }
    if (
      passwordError === "La nueva contraseña no puede ser igual a la actual" &&
      val !== oldPassword
    ) {
      setPasswordError("");
    }
  };

  const handleOldPasswordChange = (val: string) => {
    setOldPassword(val);
    if (
      passwordError === "La nueva contraseña no puede ser igual a la actual" &&
      newPassword !== val
    ) {
      setPasswordError("");
    }
    if (passwordError === "Debes ingresar tu contraseña actual" && val) {
      setPasswordError("");
    }
  };

  return (
    <div className="container mx-auto py-10 max-w-md animate-fade-in">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-2xl font-semibold leading-none tracking-tight">
            {isSocialAuth ? "Establecer Contraseña" : "Cambiar Contraseña"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isSocialAuth
              ? "Establece una contraseña para poder iniciar sesión con tu correo electrónico y contraseña."
              : "Ingresa tu nueva contraseña asegurándote de cumplir los requisitos."}
          </p>
        </div>
        <div className="p-6 pt-0">
          <div className="grid gap-4 py-4">
            {!isSocialAuth && (
              <div className="space-y-2">
                <Label htmlFor="oldPassword">Contraseña Actual</Label>
                <Input
                  id="oldPassword"
                  type={showPassword ? "text" : "password"}
                  name="oldPassword"
                  value={oldPassword}
                  onChange={(e) => handleOldPasswordChange(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Ingresa tu contraseña actual"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nueva Contraseña</Label>
              <Input
                id="newPassword"
                type={showPassword ? "text" : "password"}
                name="newPassword"
                value={newPassword}
                onChange={(e) => handleNewPasswordChange(e.target.value)}
                autoComplete="new-password"
                placeholder="Ingresa tu nueva contraseña"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                autoComplete="new-password"
                placeholder="Confirma tu nueva contraseña"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <span className="text-red-500 text-xs text-medium">
                  Las contraseñas no coinciden
                </span>
              )}
            </div>

            {allReqsMet || newPassword.length === 0 ? null : (
              <div
                className="flex flex-col gap-1 text-xs text-muted-foreground"
                data-testid="password-requirements"
              >
                <span
                  className={cn(
                    "flex items-center gap-1",
                    pwdReqs.hasUppercase
                      ? "text-green-600"
                      : "text-muted-foreground"
                  )}
                >
                  {pwdReqs.hasUppercase ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Mayúscula
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    pwdReqs.hasLowercase
                      ? "text-green-600"
                      : "text-muted-foreground"
                  )}
                >
                  {pwdReqs.hasLowercase ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Minúscula
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    pwdReqs.hasNumber
                      ? "text-green-600"
                      : "text-muted-foreground"
                  )}
                >
                  {pwdReqs.hasNumber ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  1 Número
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1",
                    pwdReqs.hasLength
                      ? "text-green-600"
                      : "text-muted-foreground"
                  )}
                >
                  {pwdReqs.hasLength ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}{" "}
                  8 Caracteres
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Ocultar contraseñas" : "Mostrar contraseñas"}
              </Button>
            </div>

            {passwordError && (
              <p className="text-sm text-destructive font-medium">
                {passwordError}
              </p>
            )}
          </div>
        </div>
        <div className={`${FULL_PAGE_FORM_ACTIONS_CLASS} p-6 pt-0`}>
          <Button
            variant="outline"
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            onClick={() => {
              navigate(-1);
            }}
          >
            {FULL_PAGE_FORM_BACK_LABEL}
          </Button>
          <Button
            onClick={handleSavePassword}
            className={FULL_PAGE_FORM_ACTION_BUTTON_CLASS}
            disabled={
              !allReqsMet ||
              (!isSocialAuth && !oldPassword) ||
              newPassword !== confirmPassword
            }
          >
            {FULL_PAGE_FORM_SAVE_LABEL}
          </Button>
        </div>
      </div>
    </div>
  );
};
