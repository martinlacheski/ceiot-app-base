import type { LucideIcon } from "lucide-react";
import { Building2, Cpu, RadioTower, WifiOff } from "lucide-react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FleetPresence } from "./overviewModel";

type Tone = "neutral" | "positive" | "attention";

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
  href: string;
  testId: string;
  loading: boolean;
  tone?: Tone;
}

function KpiTile({ label, value, caption, icon: Icon, href, testId, loading, tone = "neutral" }: KpiTileProps) {
  return (
    <Link
      to={href}
      aria-busy={loading || undefined}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", TONE_CLASSES[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <div data-testid={testId} className="text-3xl font-semibold leading-none tabular-nums">
        {loading ? <Skeleton className="h-8 w-16" /> : value ?? "—"}
      </div>
      <p data-testid={`${testId}-caption`} className="truncate text-xs text-muted-foreground">
        {loading ? "Cargando…" : caption}
      </p>
    </Link>
  );
}

const percentFormatter = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

interface OverviewKpisProps {
  environmentsTotal?: number;
  environmentsLoading: boolean;
  devicesTotal?: number;
  devicesShown: number;
  devicesLoading: boolean;
  /** False while the device inventory has never loaded, so presence counts would be invented. */
  devicesAvailable: boolean;
  presence: FleetPresence;
}

export function OverviewKpis({
  environmentsTotal,
  environmentsLoading,
  devicesTotal,
  devicesShown,
  devicesLoading,
  devicesAvailable,
  presence,
}: OverviewKpisProps) {
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

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <KpiTile
        label="Establecimientos"
        value={environmentsTotal}
        caption="Ubicaciones de tu cuenta"
        icon={Building2}
        href="/app/environments"
        testId="kpi-environments"
        loading={environmentsLoading}
      />
      <KpiTile
        label="Dispositivos"
        value={devicesTotal}
        caption="Vinculados a tu cuenta"
        icon={Cpu}
        href="/app/devices"
        testId="kpi-devices"
        loading={devicesLoading}
      />
      <KpiTile
        label="En línea"
        value={devicesAvailable ? presence.online : undefined}
        caption={onlineCaption}
        icon={RadioTower}
        href="/app/devices"
        testId="kpi-online"
        loading={devicesLoading}
        tone={presence.online > 0 ? "positive" : "neutral"}
      />
      <KpiTile
        label="Sin conexión"
        value={devicesAvailable ? presence.offline : undefined}
        caption={offlineCaption}
        icon={WifiOff}
        href="/app/devices"
        testId="kpi-offline"
        loading={devicesLoading}
        tone={presence.offline > 0 ? "attention" : "neutral"}
      />
    </div>
  );
}
