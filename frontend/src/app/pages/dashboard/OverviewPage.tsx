import { useQuery } from "@tanstack/react-query";
import { Building2, Cpu, MapPin, Radio, RadioTower, WifiOff } from "lucide-react";
import { Link } from "react-router";

import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { environmentService } from "@/app/services/environment.service";
import type { Device } from "@/app/types/device.types";
import { DEVICE_SORT_BY } from "@/app/types/device.types";
import type { Environment } from "@/app/types/environment.types";
import { ENVIRONMENT_SORT_BY } from "@/app/types/environment.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const INVENTORY_PAGE_SIZE = 100;

function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Cargando ${label}`} className="space-y-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function ErrorState({
  label,
  onRetry,
}: {
  label: "establecimientos" | "dispositivos";
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-destructive">No pudimos cargar los {label}.</p>
      <Button variant="outline" onClick={onRetry} aria-label={`Reintentar ${label}`}>
        Reintentar
      </Button>
    </div>
  );
}

function RefreshNotice({
  hasError,
  isFetching,
}: {
  hasError: boolean;
  isFetching: boolean;
}) {
  if (hasError) {
    return (
      <p role="status" className="text-xs text-destructive">
        No se pudo actualizar el inventario. Se muestran los últimos datos disponibles.
      </p>
    );
  }
  if (isFetching) {
    return <p role="status" className="text-xs text-muted-foreground">Actualizando inventario...</p>;
  }
  return null;
}

function EnvironmentList({ environments }: { environments: Environment[] }) {
  return (
    <ul className="divide-y">
      {environments.map((environment) => (
        <li key={environment.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{environment.name}</p>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {environment.city?.name || environment.address || "Ubicación no informada"}
              </span>
            </p>
          </div>
          <Badge variant={environment.isActive ? "default" : "secondary"}>
            {environment.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function DeviceList({ devices }: { devices: Device[] }) {
  return (
    <ul className="divide-y">
      {devices.map((device) => (
        <li
          key={device.id}
          data-testid={`device-${device.id}`}
          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{device.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {device.serial}
              {device.environment?.name ? ` · ${device.environment.name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={device.brokerConnected ? "default" : "secondary"}>
              {device.brokerConnected ? <Radio className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
              {device.brokerConnected ? "Online" : "Offline"}
            </Badge>
            <Badge variant="outline">{device.enabled ? "Habilitado" : "Deshabilitado"}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewPage() {
  const environmentsQuery = useQuery({
    queryKey: ["environments", "operational-overview"],
    queryFn: () => environmentService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: ENVIRONMENT_SORT_BY.NAME,
      sortOrder: "asc",
    }),
  });

  const devicesQuery = useQuery({
    queryKey: ["devices", "operational-overview"],
    queryFn: () => deviceService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: DEVICE_SORT_BY.NAME,
      sortOrder: "asc",
    }),
  });

  const environments = environmentsQuery.data?.items ?? [];
  const devices = devicesQuery.data?.items ?? [];
  const onlineDevices = devices.filter((device) => device.brokerConnected).length;
  const offlineDevices = devices.length - onlineDevices;

  return (
    <PageHeader
      title="Resumen operativo"
      subtitle="Inventario y conectividad disponible de tus establecimientos y dispositivos"
    >
      <div className="grid gap-4 pt-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Establecimientos</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Ubicaciones disponibles en tu cuenta</p>
            </div>
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {environmentsQuery.isPending ? (
              <LoadingState label="establecimientos" />
            ) : environmentsQuery.isError && !environmentsQuery.data ? (
              <ErrorState
                label="establecimientos"
                onRetry={() => void environmentsQuery.refetch()}
              />
            ) : (
              <>
                <div className="flex items-end justify-between gap-3 border-b pb-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Total disponible</p>
                    <p data-testid="environment-total" className="text-3xl font-semibold tabular-nums">
                      {environmentsQuery.data?.total}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link to="/app/environments">Ver establecimientos</Link>
                  </Button>
                </div>
                <RefreshNotice
                  hasError={environmentsQuery.isError}
                  isFetching={environmentsQuery.isFetching}
                />
                {environments.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No hay establecimientos disponibles.
                  </p>
                ) : (
                  <EnvironmentList environments={environments} />
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Dispositivos</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Estado informado por la conexión al broker</p>
            </div>
            <Cpu className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            {devicesQuery.isPending ? (
              <LoadingState label="dispositivos" />
            ) : devicesQuery.isError && !devicesQuery.data ? (
              <ErrorState label="dispositivos" onRetry={() => void devicesQuery.refetch()} />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 border-b pb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Total disponible</p>
                    <p data-testid="device-total" className="text-2xl font-semibold tabular-nums">
                      {devicesQuery.data?.total}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RadioTower className="h-3.5 w-3.5" /> Online mostrados
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{onlineDevices}</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <WifiOff className="h-3.5 w-3.5" /> Offline mostrados
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{offlineDevices}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button asChild variant="outline">
                    <Link to="/app/devices">Ver dispositivos</Link>
                  </Button>
                </div>
                <RefreshNotice
                  hasError={devicesQuery.isError}
                  isFetching={devicesQuery.isFetching}
                />
                {devices.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No hay dispositivos disponibles.
                  </p>
                ) : (
                  <DeviceList devices={devices} />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageHeader>
  );
}
