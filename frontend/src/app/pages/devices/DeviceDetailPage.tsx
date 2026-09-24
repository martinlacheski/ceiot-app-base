import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { DeviceGuestManagementCard } from "@/app/components/access/DeviceGuestManagementCard";
import { DevicePresenceBadge } from "@/app/components/devices/DevicePresenceBadge";
import { DeviceSensorsSection } from "@/app/components/devices/DeviceSensorsSection";
import {
  formatDeviceGpsSummary,
  formatDeviceMac,
} from "@/app/components/devices/deviceTelemetry";
import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { useAuthStore } from "@/auth/store/auth.store";
import { EnvironmentalReadingsSection } from "@/components/dashboard/EnvironmentalReadingsSection";
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
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const canReadTelemetry = user?.isAdmin || user?.permissions?.includes("telemetry:read");
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
  const {
    data: latestReadings,
    isLoading: latestReadingsLoading,
    isError: latestReadingsError,
  } = useQuery({
    queryKey: ["telemetry", "latest", id],
    queryFn: () => environmentalSensorService.getLatest(id!, 1),
    enabled: Boolean(id && canReadTelemetry),
    refetchInterval: 5000,
  });
  const {
    data: historyReadings,
    isLoading: historyReadingsLoading,
    isError: historyReadingsError,
  } = useQuery({
    queryKey: ["telemetry", "history", id, range],
    queryFn: () => {
      const end = new Date();
      const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      return environmentalSensorService.getHistory(
        id!,
        start.toISOString(),
        end.toISOString(),
      );
    },
    enabled: Boolean(id && canReadTelemetry),
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
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Identificación y ubicación</CardTitle>
            <CardDescription>
              Últimos datos de conectividad reportados por el dispositivo.
            </CardDescription>
          </div>
          <DevicePresenceBadge brokerConnected={device.brokerConnected} />
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
      <DeviceSensorsSection deviceId={id} canManage={Boolean(user?.isAdmin || isOwner)} />
      {canReadTelemetry && <><label className="flex items-center gap-2 text-sm" htmlFor="telemetry-range">Período de lecturas
        <select id="telemetry-range" className="rounded-md border bg-background px-3 py-2" value={range} onChange={(event) => setRange(event.target.value as "24h" | "7d" | "30d")}>
          <option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option>
        </select>
      </label><EnvironmentalReadingsSection
        latest={latestReadings}
        history={historyReadings}
        latestLoading={latestReadingsLoading}
        historyLoading={historyReadingsLoading}
        latestError={latestReadingsError}
        historyError={historyReadingsError}
      /></>}
      <DeviceGuestManagementCard deviceId={id} isOwner={isOwner} />
    </div>
  );
}
