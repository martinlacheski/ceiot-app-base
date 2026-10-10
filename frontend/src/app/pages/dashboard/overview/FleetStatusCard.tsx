import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Link } from "react-router";

import { DevicePresenceBadge } from "@/app/components/devices/DevicePresenceBadge";
import type { Device } from "@/app/types/device.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceLabel, sortByPresence } from "./overviewModel";
import { ErrorState, LoadingState, RefreshNotice } from "./OverviewStates";

const MAX_ROWS = 8;

function lastConnectionLabel(device: Device) {
  if (!device.lastConnection) return "Sin conexiones registradas";
  const date = new Date(device.lastConnection);
  if (Number.isNaN(date.getTime())) return "Sin conexiones registradas";
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
}

interface FleetStatusCardProps {
  devices: Device[];
  total?: number;
  isPending: boolean;
  isError: boolean;
  hasData: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

export function FleetStatusCard({ devices, total, isPending, isError, hasData, isFetching, onRetry }: FleetStatusCardProps) {
  const rows = sortByPresence(devices).slice(0, MAX_ROWS);
  return (
    <Card role="region" aria-labelledby="overview-fleet-title" className="gap-4">
      <CardHeader>
        <CardTitle id="overview-fleet-title">Estado de dispositivos</CardTitle>
        <CardDescription>Conexión informada por el broker</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <LoadingState label="dispositivos" rows={3} />
        ) : isError && !hasData ? (
          <ErrorState label="dispositivos" onRetry={onRetry} />
        ) : (
          <>
            <RefreshNotice hasError={isError} isFetching={isFetching} />
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No hay dispositivos disponibles.</p>
            ) : (
              <ul className="divide-y">
                {rows.map((device) => (
                  <li key={device.id} data-testid={`device-${device.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link to={`/app/devices/${device.id}`} className="block truncate text-sm font-medium hover:underline">
                        {deviceLabel(device)}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{lastConnectionLabel(device)}</p>
                    </div>
                    <DevicePresenceBadge brokerConnected={device.brokerConnected} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.length > 0 ? `Mostrando ${rows.length} de ${total ?? devices.length}` : ""}
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link to="/app/devices" aria-label="Ver todos los dispositivos">Ver todos</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
