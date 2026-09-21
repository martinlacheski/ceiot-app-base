import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Environment } from "@/app/types/environment.types";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Phone, FileText, User, Globe } from "lucide-react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { useQuery } from "@tanstack/react-query";
import { environmentService } from "@/app/services/environment.service";

interface EnvironmentDetailDialogProps {
  environment: Environment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnvironmentDetailDialog({
  environment,
  open,
  onOpenChange,
}: EnvironmentDetailDialogProps) {
  const environmentId = environment?.id ?? "";
  const { data: invitationsData } = useQuery({
    queryKey: ["environment-guest-invitations", environmentId],
    queryFn: () =>
      environmentService.listInvitations(environmentId, {
        page: 1,
        perPage: 20,
      }),
    enabled: !!environmentId && open,
  });

  if (!environment) return null;

  // Parse location "lat,lng" safely
  let coordinates = { lat: -34.6037, lng: -58.3816 }; // Default to BA
  if (environment.location) {
    const parts = environment.location
      .split(",")
      .map((c) => parseFloat(c.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      coordinates = { lat: parts[0], lng: parts[1] };
    }
  }

  // Helper to construct full address string
  const fullLocation = [
    environment.city?.name,
    environment.city?.state?.name,
    environment.city?.state?.country?.name,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <DialogTitle className="text-xl">{environment.name}</DialogTitle>
            <Badge variant={environment.isActive ? "default" : "destructive"}>
              {environment.isActive ? "Activo" : "Inactivo"}
            </Badge>
          </div>
          <DialogDescription>
            Detalles del establecimiento {environment.name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 py-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* Column 1: Metadata */}
          <div className="space-y-6">
            {/* General Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Información General
              </h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Tipo:</span>
                  <span>{environment.type?.name || "N/A"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Dueño:</span>
                  <span>{environment.ownerName || "Sin asignar"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Rol:</span>
                  <span>
                    {environment.currentUserRole === "owner"
                      ? "Propietario"
                      : environment.currentUserRole === "guest"
                        ? "Invitado"
                        : "-"}
                  </span>
                </div>
                {environment.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Teléfono:</span>
                    <span>{environment.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Location Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Ubicación
              </h4>
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-sm">
                  <Globe className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span className="font-medium min-w-[70px]">Región:</span>
                  <span>{fullLocation || "N/A"}</span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span className="font-medium min-w-[70px]">Dirección:</span>
                  <span>{environment.address}</span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Descripción
              </h4>
              <div className="flex items-start gap-2 text-sm text-foreground bg-muted/50 p-3 rounded-md">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <p className="whitespace-pre-wrap">
                  {environment.description || "Sin descripción"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Invitados
              </h4>
              {(invitationsData?.items ?? []).length === 0 ? (
                <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  No hay invitaciones pendientes.
                </p>
              ) : (
                <div className="space-y-2">
                  {invitationsData?.items.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3 text-sm"
                    >
                      <span className="font-medium">{invitation.email}</span>
                      <Badge variant="secondary">{invitation.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Column 2: Map */}
          <div className="min-h-[460px] overflow-hidden rounded-lg border">
            <APIProvider
              apiKey={import.meta.env.VITE_GCP_API_KEY}
              language="es"
              region="AR"
            >
              <Map
                defaultCenter={coordinates}
                defaultZoom={15}
                gestureHandling={"cooperative"}
                disableDefaultUI={false}
                className="w-full h-full"
          mapId="IOT_MAP_ID"
              >
                <AdvancedMarker position={coordinates} />
              </Map>
            </APIProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
