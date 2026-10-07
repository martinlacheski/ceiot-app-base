import { useState } from "react";
import { CalendarDays, LayoutGrid, List } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { DeviceGuestManagementCard } from "@/app/components/access/DeviceGuestManagementCard";
import { DevicePresenceBadge } from "@/app/components/devices/DevicePresenceBadge";
import { DeviceFirmwareSection } from "@/app/components/devices/DeviceFirmwareSection";
import { DeviceDailySummary, DeviceDetailedReadings } from "@/app/components/devices/DeviceTelemetryTables";
import { DeviceSensorsSection } from "@/app/components/devices/DeviceSensorsSection";
import {
  formatDeviceGpsSummary,
  formatDeviceMac,
} from "@/app/components/devices/deviceTelemetry";
import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { LiveIndicator } from "@/app/live/LiveIndicator";
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
import { DateRangePicker } from "@/components/ui/date-range-picker";

type Range = "24h" | "7d" | "30d" | "custom";
type View = "charts" | "daily" | "detailed";
interface CustomRange { from: Date; to: Date }

const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30 } as const;
const VIEWS: Array<{ id: View; label: string; Icon: typeof LayoutGrid }> = [
  { id: "charts", label: "Gráficos", Icon: LayoutGrid },
  { id: "daily", label: "Resumen diario", Icon: CalendarDays },
  { id: "detailed", label: "Vista detallada", Icon: List },
];

/** ISO bounds of the period: rolling window up to `now`, or whole local days for a custom range. */
function resolvePeriod(range: Range, custom: CustomRange, now: number) {
  if (range === "custom") {
    const start = new Date(custom.from.getFullYear(), custom.from.getMonth(), custom.from.getDate(), 0, 0, 0, 0);
    const end = new Date(custom.to.getFullYear(), custom.to.getMonth(), custom.to.getDate(), 23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: new Date(now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000).toISOString(), end: new Date(now).toISOString() };
}

const nowMs = () => Date.now();

function defaultCustomRange(): CustomRange {
  const to = new Date();
  return { from: new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6), to };
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [range, setRange] = useState<Range>("24h");
  const [view, setView] = useState<View>("charts");
  const [custom, setCustom] = useState<CustomRange>(defaultCustomRange);
  // Fixed while a table view is open so its queries and exports share one period.
  const [tablePeriod, setTablePeriod] = useState<{ start: string; end: string } | null>(null);
  const changeRange = (next: Range, nextCustom = custom) => {
    setRange(next);
    setTablePeriod(resolvePeriod(next, nextCustom, nowMs()));
  };
  const changeView = (next: View) => {
    setView(next);
    setTablePeriod(resolvePeriod(range, custom, nowMs()));
  };
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
    queryKey: range === "custom"
      ? ["telemetry", "history", id, range, custom.from.toDateString(), custom.to.toDateString()]
      : ["telemetry", "history", id, range],
    queryFn: () => {
      const { start, end } = resolvePeriod(range, custom, nowMs());
      return environmentalSensorService.getHistory(id!, start, end);
    },
    enabled: Boolean(id && canReadTelemetry && view === "charts"),
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
          <div className="flex items-center gap-3">
            <LiveIndicator />
            <DevicePresenceBadge brokerConnected={device.brokerConnected} />
          </div>
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
      {user?.isAdmin && <DeviceFirmwareSection device={device} />}
      <DeviceSensorsSection deviceId={id} canManage={Boolean(user?.isAdmin || isOwner)} deviceTypeId={device.deviceTypeId} />
      {canReadTelemetry && <>
        <div role="group" aria-label="Vista de las lecturas" className="grid w-full grid-cols-3 items-center gap-1 rounded-md border p-1 sm:inline-grid sm:w-auto">
          {VIEWS.map(({ id: viewId, label, Icon }) => <Button key={viewId} type="button"
            className="h-auto min-h-11 flex-col gap-1 whitespace-normal px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            variant={view === viewId ? "secondary" : "ghost"} aria-pressed={view === viewId} onClick={() => changeView(viewId)}>
            <Icon data-icon="inline-start" />{label}
          </Button>)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2 text-sm" htmlFor="telemetry-range">Período de lecturas
            <select id="telemetry-range" className="h-11 rounded-md border bg-background px-3 py-2" value={range} onChange={(event) => changeRange(event.target.value as Range)}>
              <option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="custom">Personalizado</option>
            </select>
          </label>
          {range === "custom" && <DateRangePicker key={`${custom.from.toDateString()}|${custom.to.toDateString()}`}
            initialDateFrom={custom.from} initialDateTo={custom.to} align="start" locale="es" showCompare={false} mobileLayout
            triggerClassName="w-full sm:w-auto"
            onUpdate={({ range: picked }) => {
              const next = { from: picked.from ?? custom.from, to: picked.to ?? picked.from ?? custom.to };
              setCustom(next);
              changeRange("custom", next);
            }} />}
        </div>
        {view === "charts" && <EnvironmentalReadingsSection
          latest={latestReadings}
          history={historyReadings}
          latestLoading={latestReadingsLoading}
          historyLoading={historyReadingsLoading}
          latestError={latestReadingsError}
          historyError={historyReadingsError}
        />}
        {view === "daily" && tablePeriod && <DeviceDailySummary device={device} start={tablePeriod.start} end={tablePeriod.end} />}
        {view === "detailed" && tablePeriod && <DeviceDetailedReadings device={device} start={tablePeriod.start} end={tablePeriod.end} />}
      </>}
      <DeviceGuestManagementCard deviceId={id} isOwner={isOwner} />
    </div>
  );
}
