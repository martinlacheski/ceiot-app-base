import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { DeviceGuestManagementCard } from "@/app/components/access/DeviceGuestManagementCard";
import {
  formatDeviceGpsSummary,
  formatDeviceMac,
} from "@/app/components/devices/deviceTelemetry";
import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { useAuthStore } from "@/auth/store/auth.store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const {
    data: device,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["device", "detail", id],
    queryFn: () => deviceService.getById(id!),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Cargando dispositivo…</p>
    );
  }

  if (isError || !device || !id) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Dispositivo no encontrado</h1>
        <Link to="/app/devices">
          <Button>Volver al listado</Button>
        </Link>
      </div>
    );
  }

  const isOwner = device.environment?.ownerId === user?.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title={device.name ?? "Dispositivo"}
        subtitle={device.environment?.name || device.serial}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Identificación y ubicación</CardTitle>
          <CardDescription>
            Últimos datos de conectividad reportados por el dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">MAC</p>
            <p className="text-sm text-muted-foreground">
              {formatDeviceMac(device)}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Último GPS</p>
            <p className="text-sm text-muted-foreground">
              {formatDeviceGpsSummary(device)}
            </p>
          </div>
        </CardContent>
      </Card>
      <DeviceGuestManagementCard deviceId={id} isOwner={isOwner} />
    </div>
  );
}
