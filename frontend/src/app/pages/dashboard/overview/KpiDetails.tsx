import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { DevicePresenceBadge } from "@/app/components/devices/DevicePresenceBadge";
import type { Device } from "@/app/types/device.types";
import type { Environment } from "@/app/types/environment.types";
import { Button } from "@/components/ui/button";
import { deviceLabel } from "./overviewModel";
import { LoadingState, RefreshNotice, type InventoryLabel } from "./OverviewStates";

/** Rows listed in a KPI card; the rest are one "Ver todos" away. */
export const KPI_DETAIL_ROWS = 8;

export interface InventoryState {
  isPending: boolean;
  isError: boolean;
  hasData: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

const ROW_CLASS = "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left";
const INTERACTIVE_ROW_CLASS = `${ROW_CLASS} transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`;

function lastConnectionLabel(device: Device) {
  if (!device.lastConnection) return "Sin conexiones registradas";
  const date = new Date(device.lastConnection);
  if (Number.isNaN(date.getTime())) return "Sin conexiones registradas";
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

interface DetailsFrameProps {
  title: string;
  description: string;
  label: InventoryLabel;
  state: InventoryState;
  shown: number;
  total: number;
  emptyText: string;
  allHref: string;
  children: ReactNode;
}

function DetailsFrame({ title, description, label, state, shown, total, emptyText, allHref, children }: DetailsFrameProps) {
  let body: ReactNode;
  if (state.isPending) body = <LoadingState label={label} rows={3} />;
  else if (state.isError && !state.hasData) {
    body = <p className="py-4 text-center text-sm text-destructive">No pudimos cargar los {label}.</p>;
  } else {
    body = (
      <>
        <RefreshNotice hasError={state.isError} isFetching={state.isFetching} />
        {shown === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p> : children}
      </>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2 p-2">{body}</div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {shown > 0 ? `Mostrando ${shown} de ${total}` : ""}
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link to={allHref} aria-label={`Ver todos los ${label}`}>Ver todos</Link>
        </Button>
      </div>
    </div>
  );
}

interface DeviceDetailsProps {
  title: string;
  devices: Device[];
  total: number;
  state: InventoryState;
  emptyText: string;
  onSelectDevice: (deviceId: string) => void;
}

/** Devices of a KPI; picking one shows its readings. */
export function DeviceDetails({ title, devices, total, state, emptyText, onSelectDevice }: DeviceDetailsProps) {
  const rows = devices.slice(0, KPI_DETAIL_ROWS);
  return (
    <DetailsFrame
      title={title}
      description="Elegí uno para ver sus lecturas"
      label="dispositivos"
      state={state}
      shown={rows.length}
      total={total}
      emptyText={emptyText}
      allHref="/app/devices"
    >
      <ul>
        {rows.map((device) => (
          <li key={device.id} data-testid={`device-${device.id}`}>
            <button type="button" className={INTERACTIVE_ROW_CLASS} onClick={() => onSelectDevice(device.id)}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{deviceLabel(device)}</span>
                <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{device.environment?.name ?? "Sin establecimiento"}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{lastConnectionLabel(device)}</span>
                </span>
              </span>
              <DevicePresenceBadge brokerConnected={device.brokerConnected} className="shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </DetailsFrame>
  );
}

interface EnvironmentDetailsProps {
  environments: Environment[];
  total: number;
  /** Loaded devices per establishment id. */
  deviceCounts: Map<string, number>;
  state: InventoryState;
  onSelectEnvironment: (environmentId: string) => void;
}

/** Establishments with their device count; picking one with devices compares its sensors. */
export function EnvironmentDetails({ environments, total, deviceCounts, state, onSelectEnvironment }: EnvironmentDetailsProps) {
  const rows = environments.slice(0, KPI_DETAIL_ROWS);
  return (
    <DetailsFrame
      title="Establecimientos"
      description="Elegí uno para comparar sus sensores"
      label="establecimientos"
      state={state}
      shown={rows.length}
      total={total}
      emptyText="No hay establecimientos disponibles."
      allHref="/app/environments"
    >
      <ul>
        {rows.map((environment) => {
          const count = deviceCounts.get(environment.id) ?? 0;
          const content = (
            <>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{environment.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{environment.city?.name || environment.address || "Ubicación no informada"}</span>
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {count > 0 ? plural(count, "dispositivo", "dispositivos") : "Sin dispositivos"}
              </span>
            </>
          );
          return (
            <li key={environment.id} data-testid={`environment-${environment.id}`}>
              {count > 0 ? (
                <button type="button" className={INTERACTIVE_ROW_CLASS} onClick={() => onSelectEnvironment(environment.id)}>
                  {content}
                </button>
              ) : (
                <div className={ROW_CLASS}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </DetailsFrame>
  );
}
