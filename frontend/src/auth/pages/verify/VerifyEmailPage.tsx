import { appApi } from "@/api/appApi";
import { Logo } from "@/components/custom/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router"; // react-router v6 uses useSearchParams

export const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const { isLoading, isError, error, isSuccess } = useQuery({
    queryKey: ["verifyEmail", token],
    queryFn: async () => {
      const { data } = await appApi.get(`/auth/verify-email?token=${token}`);
      return data;
    },
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const errorMessage =
    error instanceof AxiosError
      ? error.response?.data?.detail || "Error al verificar el correo"
      : "Error desconocido";

  if (!token) {
    return (
      <div className="flex flex-col gap-6 max-w-md w-full mx-auto">
        <Card className="w-full">
          <CardHeader className="text-center flex flex-col items-center">
            <Logo />
            <CardTitle className="mt-4">Error de verificación</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 text-center">
            <ErrorContent message="Token no proporcionado" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-md w-full mx-auto">
      <Card className="w-full">
        <CardHeader className="text-center flex flex-col items-center">
          <Logo />
          <CardTitle className="mt-4">Verificación de Cuenta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 text-center">
          {isLoading && <LoadingContent />}
          {isSuccess && <SuccessContent />}
          {isError && <ErrorContent message={errorMessage} />}
        </CardContent>
      </Card>
    </div>
  );
};

const LoadingContent = () => (
  <div className="flex flex-col items-center gap-2">
    <Loader2 className="h-10 w-10 animate-spin text-primary" />
    <p>Verificando tu correo...</p>
  </div>
);

const SuccessContent = () => (
  <div className="flex flex-col items-center gap-4">
    <CheckCircle2 className="h-16 w-16 text-green-500" />
    <div className="space-y-2">
      <h3 className="text-xl font-medium">¡Correo verificado!</h3>
      <p className="mt-2 text-muted-foreground">
        Tu cuenta ha sido activada correctamente.
      </p>
      <p className="text-muted-foreground">Ya puedes iniciar sesión.</p>
    </div>
    <Button asChild className="w-full">
      <Link to="/auth/login">Ir al Login</Link>
    </Button>
  </div>
);

const ErrorContent = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center gap-4">
    <XCircle className="h-16 w-16 text-destructive" />
    <div className="space-y-2">
      <h3 className="text-xl font-medium">Error de verificación</h3>
      <p className="text-muted-foreground">
        {message || "El enlace es inválido o ha expirado."}
      </p>
    </div>
    <Button asChild variant="outline" className="w-full">
      <Link to="/auth/login">Volver al Login</Link>
    </Button>
  </div>
);
