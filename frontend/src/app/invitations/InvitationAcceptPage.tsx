import { useNavigate, useSearchParams, Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/custom/Logo";
import {
  getInvitationAction,
  acceptInvitationAction,
  declineInvitationAction,
} from "@/app/actions/invitation.actions";
import { showConfirmDialog } from "@/store/confirm.store";
import { useAuthStore } from "@/auth/store/auth.store";

export default function InvitationAcceptPage() {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get("id");
  const navigate = useNavigate();
  const { authStatus } = useAuthStore();
  const nextPath = invitationId ? `/invitations/accept?id=${invitationId}` : "/app";
  const loginHref = `/auth/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(nextPath)}`;

  const rememberInvitationReturn = () => {
    window.sessionStorage.setItem("auth:returnTo", nextPath);
  };

  const {
    data: invitation,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => getInvitationAction(invitationId!),
    enabled: !!invitationId,
    retry: false,
  });
  const ownerEmail = invitation?.ownerEmail ?? invitation?.owner_email;
  const scopeType = invitation?.scopeType ?? invitation?.scope_type;
  const scopeName =
    invitation?.scopeName ??
    invitation?.scope_name ??
    invitation?.environmentName ??
    invitation?.environment_name;
  const scopeLabel = scopeType === "device" ? "dispositivo" : "establecimiento";
  const invitationStatus = invitation?.status?.toLowerCase();
  const invitedUserExists = Boolean(
    invitation?.invitedUserExists ?? invitation?.invited_user_exists,
  );

  const acceptMutation = useMutation({
    mutationFn: acceptInvitationAction,
    onSuccess: () => {
      toast.success("Invitación aceptada correctamente");
      navigate("/app"); // Redirect to dashboard
    },
    onError: () => {
      toast.error("Error al aceptar la invitación");
    },
  });

  const declineMutation = useMutation({
    mutationFn: declineInvitationAction,
    onSuccess: () => {
      toast.success("Invitación rechazada");
      navigate("/app"); // Redirect home/dashboard
    },
    onError: () => {
      toast.error("Error al rechazar la invitación");
    },
  });

  const handleDecline = () => {
    showConfirmDialog(
      "¿Estás seguro que deseas rechazar esta invitación?",
      async () => {
        await declineMutation.mutateAsync(invitationId!);
      }
    );
  };

  const handleAccept = () => {
    showConfirmDialog(
      `¿Estás seguro que deseas aceptar y unirte a este ${scopeLabel}?`,
      async () => {
        await acceptMutation.mutateAsync(invitationId!);
      }
    );
  };

  if (!invitationId) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm border-destructive/20 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-destructive">Enlace inválido</CardTitle>
            <CardDescription>
              No se ha proporcionado un ID de invitación válido.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm font-medium">
            Cargando invitación...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center flex flex-col items-center">
            <div className="bg-destructive/10 p-3 rounded-full mb-4">
              <X className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Error</CardTitle>
            <CardDescription className="pt-2">
              {(error as { response?: { data?: { detail?: string } } })
                ?.response?.data?.detail ||
                "No se pudo cargar la invitación. Puede que haya sido revocada o no tengas permiso."}
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center pt-2">
            <Button variant="outline" onClick={() => navigate("/app")}>
              Volver al Inicio
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Si ya no está pendiente, mostrar estado
  if (invitationStatus !== "pending" && invitationStatus !== "pendiente") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm shadow-xl border-t-4 border-t-primary/20">
          <CardHeader className="text-center flex flex-col items-center">
            <div
              className={`p-3 rounded-full mb-4 ${
                invitationStatus === "accepted" || invitationStatus === "aceptada"
                  ? "bg-green-100 text-green-600"
                  : invitationStatus === "declined" || invitationStatus === "rechazada"
                  ? "bg-red-100 text-red-600"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {(invitationStatus === "accepted" || invitationStatus === "aceptada") && (
                <Check className="h-6 w-6" />
              )}
              {(invitationStatus === "declined" || invitationStatus === "rechazada") && <X className="h-6 w-6" />}
              {(invitationStatus === "revoked" || invitationStatus === "revocada") && <X className="h-6 w-6" />}
            </div>
            <CardTitle>Invitación Procesada</CardTitle>
            <CardDescription className="pt-2 text-balance">
              Esta invitación ya ha sido procesada anteriormente.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <div className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
              Estado: {invitation?.status}
            </div>
          </CardContent>
          <CardFooter className="justify-center pt-2">
            <Button
              onClick={() => navigate("/app")}
              variant="default"
              className="w-full"
            >
              Ir al Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (authStatus !== "authenticated") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-lg shadow-xl border-border/40">
          <CardHeader className="flex flex-col items-center gap-6 pb-2 pt-10">
            <div className="scale-125">
              <Logo />
            </div>
            <div className="text-center space-y-4">
              <CardTitle className="text-3xl font-bold tracking-tight">
                Te han invitado
              </CardTitle>
              <CardDescription className="text-lg text-balance text-muted-foreground/80">
                Has recibido una invitación de{" "}
                <span className="font-semibold text-foreground">
                  {ownerEmail}
                </span>{" "}
                para unirte al {scopeLabel}{" "}
                <span className="font-semibold text-foreground">{scopeName}</span>
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 text-center pb-10">
            <p className="text-base text-muted-foreground">
              {invitedUserExists
                ? "Ingresá con el correo electrónico invitado para aceptar esta invitación."
                : "Creá una cuenta con el correo electrónico que recibiste la invitación para aceptarla."}
            </p>
          </CardContent>

          <CardFooter className="grid grid-cols-1 gap-3 px-8 pb-10">
            <Button asChild size="lg" className="w-full text-base font-medium">
              <Link
                to={invitedUserExists ? loginHref : registerHref}
                onClick={rememberInvitationReturn}
              >
                {invitedUserExists ? "Ingresar para aceptar" : "Crear cuenta para aceptar"}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-lg shadow-xl border-border/40">
        <CardHeader className="flex flex-col items-center gap-6 pb-2 pt-10">
          <div className="scale-125">
            <Logo />
          </div>
          <div className="text-center space-y-4">
            <CardTitle className="text-3xl font-bold tracking-tight">
              Te han invitado
            </CardTitle>
            <CardDescription className="text-lg text-balance text-muted-foreground/80">
              Has recibido una invitación de{" "}
              <span className="font-semibold text-foreground">
                {ownerEmail}
              </span>{" "}
               para unirte al {scopeLabel}{" "}
              <span className="font-semibold text-foreground">{scopeName}</span>
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="text-center pb-10">
          <div className="py-6">
            <h2 className="text-3xl font-bold text-foreground break-words">
              {scopeName}
            </h2>
          </div>
          <p className="text-base text-muted-foreground">
            ¿Deseas aceptar para colaborar en este {scopeLabel}?
          </p>
        </CardContent>

        <CardFooter className="grid grid-cols-2 gap-4 px-8 pb-10">
          <Button
            variant="outline"
            size="lg"
            className="w-full text-base font-medium text-destructive hover:text-destructive hover:bg-destructive/5 border-muted-foreground/20"
            onClick={handleDecline}
            disabled={declineMutation.isPending || acceptMutation.isPending}
          >
            {declineMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Rechazar
          </Button>

          <Button
            size="lg"
            className="w-full text-base font-medium"
            onClick={handleAccept}
            disabled={declineMutation.isPending || acceptMutation.isPending}
          >
            {acceptMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Aceptar
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
