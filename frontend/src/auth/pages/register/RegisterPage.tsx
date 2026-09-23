import { useAuthStore } from "@/auth/store/auth.store";
import { Logo } from "@/components/custom/Logo";
import { SmartDatePicker } from "@/components/custom/SmartDatePicker";
import { SmartPhoneInput } from "@/components/custom/SmartPhoneInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE_URL } from "@/lib/apiBaseUrl";
import { showConfirmDialog } from "@/store/confirm.store";
import { cn } from "@/utils/utils";
import {
  getPasswordRequirements,
  isValidEmail,
  isValidIdentification,
} from "@/utils/validators";
import { Check, X as XIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { AuthConsentNotice } from "@/auth/components/AuthConsentNotice";

export const RegisterPage = () => {
  const {
    registerUser,
    checkUsernameAvailability,
    checkEmailAvailability,
    checkIdentificationAvailability,
  } = useAuthStore();
  const [searchParams] = useSearchParams();
  const [isPosting, setIsPosting] = useState(false);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState<Date | undefined>(undefined);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [identificationError, setIdentificationError] = useState("");
  const [isRegistrationSuccess, setIsRegistrationSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const nextPath = searchParams.get("next");
  const storedReturnPath = window.sessionStorage.getItem("auth:returnTo");
  const returnPath = nextPath || storedReturnPath;
  const loginHref = nextPath
    ? `/auth/login?next=${encodeURIComponent(nextPath)}`
    : storedReturnPath
    ? `/auth/login?next=${encodeURIComponent(storedReturnPath)}`
    : "/auth/login";
  const usernameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const identificationRef = useRef<HTMLInputElement>(null);

  const handleSocialLogin = (provider: string) => {
    if (returnPath) {
      window.sessionStorage.setItem("auth:returnTo", returnPath);
    }
    const apiUrl = API_BASE_URL;
    const nextQuery = returnPath ? `?next=${encodeURIComponent(returnPath)}` : "";
    window.location.href = `${apiUrl}/auth/${provider}/login${nextQuery}`;
  };

  const handleBlurUsername = async () => {
    if (usernameRef.current && usernameRef.current.value) {
      const isAvailable = await checkUsernameAvailability(
        usernameRef.current.value
      );
      if (!isAvailable) {
        setUsernameError("El nombre de usuario ya está en uso");
        usernameRef.current.focus();
      } else {
        setUsernameError("");
      }
    }
  };

  const handleBlurEmail = async () => {
    if (emailRef.current && emailRef.current.value) {
      const emailValue = emailRef.current.value;

      if (!isValidEmail(emailValue)) {
        setEmailError("Formato de correo electrónico inválido");
        emailRef.current.focus();
        return;
      }

      const isAvailable = await checkEmailAvailability(emailValue);
      if (!isAvailable) {
        setEmailError("El correo electrónico ya está en uso");
        emailRef.current.focus();
      } else {
        setEmailError("");
      }
    }
  };

  const handleBlurIdentification = async () => {
    if (identificationRef.current && identificationRef.current.value) {
      const idValue = identificationRef.current.value;

      if (!isValidIdentification(idValue)) {
        setIdentificationError(
          "El número de documento debe contener solo números"
        );
        identificationRef.current.focus();
        return;
      }

      const isAvailable = await checkIdentificationAvailability(idValue);
      if (!isAvailable) {
        setIdentificationError("El número de documento ya está registrado");
        identificationRef.current.focus();
      } else {
        setIdentificationError("");
      }
    }
  };

  const {
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasLength: has8Characters,
  } = getPasswordRequirements(password);

  const isPasswordValid =
    hasUppercase && hasLowercase && hasNumber && has8Characters;

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !isPasswordValid ||
      password !== confirmPassword ||
      usernameError ||
      emailError ||
      identificationError ||
      !birthDate
    ) {
      return;
    }

    showConfirmDialog(
      "¿Estás seguro de que deseas crear esta cuenta?",
      async () => {
        setIsPosting(true);
        const formData = new FormData(event.target as HTMLFormElement);
        const username = formData.get("username") as string;
        const firstName = formData.get("firstName") as string;
        const lastName = formData.get("lastName") as string;
        const identificationNumber = formData.get(
          "identificationNumber"
        ) as string;
        const email = formData.get("email") as string;
        // const password = formData.get("password") as string; // Already in state

        const isValid = await registerUser(
          username,
          firstName,
          lastName,
          identificationNumber,
          email,
          password,
          phone,
          birthDate
        );

        if (isValid) {
          if (returnPath) {
            window.sessionStorage.setItem("auth:returnTo", returnPath);
          }
          toast.success("Registro exitoso. Por favor verifica tu email.");
          // navigate("/auth/login");
          setIsRegistrationSuccess(true);
          return;
        }

        toast.error("Error al registrar el usuario");
        setIsPosting(false);
      }
    );
  };

  if (isRegistrationSuccess) {
    return (
      <div className="flex flex-col gap-6 max-w-md w-full mx-auto">
        <Card className="overflow-hidden p-6 md:p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <Check className="h-16 w-16 text-green-500" />
            <h3 className="text-xl font-medium">¡Cuenta creada!</h3>
            <p className="text-muted-foreground">
              Hemos enviado un enlace de verificación a tu correo electrónico.
              Por favor revísalo para activar tu cuenta.
            </p>
            <Button asChild className="w-full">
              <Link to={loginHref}>
                {nextPath
                  ? "Ir al login para aceptar la invitación"
                  : "Ir al Login"}
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl animate-fade-in">
      <Card className="overflow-hidden p-0  ">
        <CardContent className="grid p-0 md:grid-cols-1">
          <form className="p-6 md:p-8" onSubmit={handleRegister}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <h1 className="mb-4 text-xl font-bold text-balance md:text-2xl">
                  Monitoreo Ambiental IoT
                </h1>
                <Logo />

                <p className="text-balance text-muted-foreground">
                  Crea una nueva cuenta
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="username">Nombre de usuario</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Ingrese su nombre de usuario"
                  required
                  ref={usernameRef}
                  onBlur={handleBlurUsername}
                />
                {usernameError && (
                  <span className="text-red-500 text-xs">{usernameError}</span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="firstName">Nombres</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    type="text"
                    placeholder="Ingrese sus nombres"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lastName">Apellidos</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    type="text"
                    placeholder="Ingrese sus apellidos"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="identificationNumber">
                    Número de documento (DNI)
                  </Label>
                  <Input
                    id="identificationNumber"
                    name="identificationNumber"
                    type="text"
                    placeholder="Ingrese su número de documento"
                    required
                    ref={identificationRef}
                    onBlur={handleBlurIdentification}
                  />
                  {identificationError && (
                    <span className="text-red-500 text-xs">
                      {identificationError}
                    </span>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Teléfono</Label>
                  <SmartPhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="Ingrese su número de teléfono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Ingrese su correo electrónico"
                    required
                    ref={emailRef}
                    onBlur={handleBlurEmail}
                  />
                  {emailError && (
                    <span className="text-red-500 text-xs">{emailError}</span>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Fecha de nacimiento</Label>
                  <SmartDatePicker
                    value={birthDate}
                    onChange={setBirthDate}
                    disabled={(date) =>
                      date > new Date() || date < new Date("1900-01-01")
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="password">Contraseña</Label>
                    </div>
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Ingrese su contraseña"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="confirmPassword">
                        Confirmar contraseña
                      </Label>
                    </div>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Confirmar contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    {confirmPassword && password !== confirmPassword && (
                      <span className="text-red-500 text-xs">
                        Las contraseñas no coinciden
                      </span>
                    )}
                  </div>
                </div>

                {isPasswordValid || password.length === 0 ? null : (
                  <div className="flex flex-col gap-1 text-sm text-destructive font-medium">
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

              <Button
                type="submit"
                className="w-full"
                disabled={
                  isPosting ||
                  !isPasswordValid ||
                  password !== confirmPassword ||
                  !!usernameError ||
                  !!emailError ||
                  !!identificationError ||
                  !birthDate
                }
              >
                Crear cuenta
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
                  onClick={() => handleSocialLogin("google")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
                    />
                  </svg>
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
                ¿Ya tienes cuenta?{" "}
                <Link to={loginHref} className="underline underline-offset-4">
                  Ingresa ahora
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <AuthConsentNotice />
    </div>
  );
};
