import type { LucideIcon } from "lucide-react";
import { Building2, Cpu, RadioTower, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Device } from "@/app/types/device.types";
import type { Environment } from "@/app/types/environment.types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DeviceDetails, EnvironmentDetails, type InventoryState } from "./KpiDetails";
import { KpiPopover } from "./KpiPopover";
import { sortByPresence, type FleetPresence } from "./overviewModel";
import { ErrorState } from "./OverviewStates";

type Tone = "neutral" | "positive" | "attention";
type KpiId = "environments" | "devices" | "online" | "offline";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

interface KpiTileProps {
  label: string;
  value?: number;
  caption: string;
  icon: LucideIcon;
  testId: string;
  loading: boolean;
  tone?: Tone;
}

function KpiTileContent({ label, value, caption, icon: Icon, testId, loading, tone = "neutral" }: KpiTileProps) {
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", TONE_CLASSES[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </span>
      <span data-testid={testId} className="text-3xl font-semibold leading-none tabular-nums">
        {loading ? <Skeleton className="h-8 w-16" /> : value ?? "—"}
      </span>
      <span data-testid={`${testId}-caption`} className="truncate text-xs text-muted-foreground">
        {loading ? "Cargando…" : caption}
      </span>
    </>
  );
}

const percentFormatter = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

interface OverviewKpisProps {
  environments: Environment[];
  environmentsTotal?: number;
  environmentsState: InventoryState;
  devices: Device[];
  devicesTotal?: number;
  devicesState: InventoryState;
  presence: FleetPresence;
  /** Shows the readings of a device picked in a KPI card. */
  onSelectDevice: (deviceId: string) => void;
  /** Compares the sensors of an establishment picked in a KPI card. */
  onSelectEnvironment: (environmentId: string) => void;
}

/** Fleet KPI tiles; each opens a card listing its devices or establishments, which drive the readings. */
export function OverviewKpis({
  environments,
  environmentsTotal,
  environmentsState,
  devices,
  devicesTotal,
  devicesState,
  presence,
  onSelectDevice,
  onSelectEnvironment,
}: OverviewKpisProps) {
  const [openKpi, setOpenKpi] = useState<KpiId | null>(null);
  const devicesAvailable = devicesState.hasData;
  const devicesShown = devices.length;

  const onlineCaption = !devicesAvailable
    ? "Sin datos"
    : devicesShown === 0
      ? "Sin dispositivos"
      : `${percentFormatter.format(presence.online / devicesShown)} de los mostrados`;
  const offlineCaption = !devicesAvailable
    ? "Sin datos"
    : presence.unknown > 0
      ? `${presence.unknown} sin dato de conexión`
      : "Desconectados del broker";

  const selectDevice = (deviceId: string) => {
    setOpenKpi(null);
    onSelectDevice(deviceId);
  };
  const selectEnvironment = (environmentId: string) => {
    setOpenKpi(null);
    onSelectEnvironment(environmentId);
  };
  const popover = (id: KpiId, label: string, busy: boolean, tile: ReactNode, details: ReactNode) => (
    <KpiPopover
      open={openKpi === id}
      onOpenChange={(open) => setOpenKpi((current) => (open ? id : current === id ? null : current))}
      label={label}
      busy={busy}
      tile={tile}
    >
      {details}
    </KpiPopover>
  );

  const deviceCounts = new Map<string, number>();
  for (const device of devices) {
    if (device.environment) deviceCounts.set(device.environment.id, (deviceCounts.get(device.environment.id) ?? 0) + 1);
  }
  const online = devices.filter((device) => device.brokerConnected === true);
  const offline = devices.filter((device) => device.brokerConnected === false);
  const deviceList = (title: string, list: Device[], total: number, emptyText: string) => (
    <DeviceDetails
      title={title}
      devices={list}
      total={total}
      state={devicesState}
      emptyText={emptyText}
      onSelectDevice={selectDevice}
    />
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {popover(
          "environments",
          "Establecimientos",
          environmentsState.isPending,
          <KpiTileContent
            label="Establecimientos"
            value={environmentsTotal}
            caption="Ubicaciones de tu cuenta"
            icon={Building2}
            testId="kpi-environments"
            loading={environmentsState.isPending}
          />,
          <EnvironmentDetails
            environments={environments}
            total={environmentsTotal ?? environments.length}
            deviceCounts={deviceCounts}
            state={environmentsState}
            onSelectEnvironment={selectEnvironment}
          />,
        )}
        {popover(
          "devices",
          "Dispositivos",
          devicesState.isPending,
          <KpiTileContent
            label="Dispositivos"
            value={devicesTotal}
            caption="Vinculados a tu cuenta"
            icon={Cpu}
            testId="kpi-devices"
            loading={devicesState.isPending}
          />,
          deviceList("Dispositivos", sortByPresence(devices), devicesTotal ?? devices.length, "No hay dispositivos disponibles."),
        )}
        {popover(
          "online",
          "Dispositivos en línea",
          devicesState.isPending,
          <KpiTileContent
            label="En línea"
            value={devicesAvailable ? presence.online : undefined}
            caption={onlineCaption}
            icon={RadioTower}
            testId="kpi-online"
            loading={devicesState.isPending}
            tone={presence.online > 0 ? "positive" : "neutral"}
          />,
          deviceList("Dispositivos en línea", online, online.length, "Ningún dispositivo está en línea."),
        )}
        {popover(
          "offline",
          "Dispositivos sin conexión",
          devicesState.isPending,
          <KpiTileContent
            label="Sin conexión"
            value={devicesAvailable ? presence.offline : undefined}
            caption={offlineCaption}
            icon={WifiOff}
            testId="kpi-offline"
            loading={devicesState.isPending}
            tone={presence.offline > 0 ? "attention" : "neutral"}
          />,
          deviceList("Dispositivos sin conexión", offline, offline.length, "Ningún dispositivo está desconectado."),
        )}
      </div>
      {environmentsState.isError && !environmentsState.hasData && (
        <ErrorState label="establecimientos" onRetry={environmentsState.onRetry} />
      )}
      {devicesState.isError && !devicesState.hasData && (
        <ErrorState label="dispositivos" onRetry={devicesState.onRetry} />
      )}
    </div>
  );
}
