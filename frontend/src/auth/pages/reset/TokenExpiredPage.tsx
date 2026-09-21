import { Logo } from "@/components/custom/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router";

export const TokenExpiredPage = () => {
  return (
    <div className={"flex flex-col gap-6 max-w-md w-full mx-auto"}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-1">
          <div className="p-6 md:p-8">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <Logo />
                <h1 className="text-2xl font-bold text-destructive">
                  Solicitud expirada
                </h1>
                <p className="text-balance text-muted-foreground">
                  El enlace para restablecer tu contraseña ha expirado o no es
                  válido.
                </p>
              </div>

              <div className="grid gap-4">
                <p className="text-center text-sm text-muted-foreground">
                  Por seguridad, los enlaces de recuperación tienen un tiempo de
                  validez limitado. Por favor, solicita uno nuevo.
                </p>
                <Button asChild className="w-full">
                  <Link to="/auth/login">Volver a iniciar sesión</Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
