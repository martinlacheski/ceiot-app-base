import { ArrowUpRight, Cpu, Link as LinkIcon, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Device } from "@/app/types/device.types";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { EnvironmentalReadingsSection } from "@/components/dashboard/EnvironmentalReadingsSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deviceLabel, READINGS_RANGES, type ReadingsRange } from "./overviewModel";

export interface TelemetryState {
  latest?: TelemetryPage;
  history?: TelemetryPage;
  latestLoading: boolean;
  historyLoading: boolean;
  latestError: boolean;
  historyError: boolean;
}

interface ReadingsPanelProps {
  devicesStatus: "loading" | "error" | "ready";
  devices: Device[];
  selectedDevice?: Device;
  onSelectDevice: (deviceId: string) => void;
  range: ReadingsRange;
  onRangeChange: (range: ReadingsRange) => void;
  canReadTelemetry: boolean;
  telemetry: TelemetryState;
}

function Notice({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <p className="font-medium">{title}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function ReadingsToolbar({
  devices,
  selectedDevice,
  onSelectDevice,
  range,
  onRangeChange,
}: Pick<ReadingsPanelProps, "devices" | "onSelectDevice" | "range" | "onRangeChange"> & { selectedDevice: Device }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor="overview-device" className="text-xs font-medium text-muted-foreground">Dispositivo</label>
        <select
          id="overview-device"
          className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:max-w-sm"
          value={selectedDevice.id}
          onChange={(event) => onSelectDevice(event.target.value)}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {deviceLabel(device)}{device.environment?.name ? ` · ${device.environment.name}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end justify-between gap-2 sm:justify-start">
        <div role="group" aria-label="Período de lecturas" className="inline-flex rounded-md border p-0.5">
          {READINGS_RANGES.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={range === option.id ? "secondary" : "ghost"}
              aria-pressed={range === option.id}
              aria-label={option.description}
              title={option.description}
              className="h-8 px-3 tabular-nums"
              onClick={() => onRangeChange(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button asChild variant="outline" size="sm" className="h-9">
          <Link to={`/app/devices/${selectedDevice.id}`}>
            Ver detalle
            <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function ReadingsPanel(props: ReadingsPanelProps) {
  const { devicesStatus, devices, selectedDevice, canReadTelemetry, telemetry } = props;

  if (devicesStatus === "loading") {
    return (
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }
  if (devicesStatus === "error" && devices.length === 0) {
    return (
      <Notice icon={Cpu} title="Las lecturas aparecen cuando se cargan los dispositivos." />
    );
  }
  if (!selectedDevice) {
    return (
      <Notice icon={Cpu} title="Todavía no hay dispositivos vinculados.">
        <p className="max-w-sm text-sm text-muted-foreground">
          Asociá tu primer dispositivo para ver sus lecturas y gráficos acá.
        </p>
        <Button asChild>
          <Link to="/app/devices/pair">
            <LinkIcon data-icon="inline-start" aria-hidden="true" />
            Asociar dispositivo
          </Link>
        </Button>
      </Notice>
    );
  }

  return (
    <section aria-label="Lecturas" className="space-y-3">
      <ReadingsToolbar {...props} selectedDevice={selectedDevice} />
      {canReadTelemetry ? (
        <EnvironmentalReadingsSection {...telemetry} />
      ) : (
        <Notice icon={Lock} title="Tu usuario no tiene permiso para ver lecturas.">
          <p className="text-sm text-muted-foreground">Pedile a un administrador el permiso de telemetría.</p>
        </Notice>
      )}
    </section>
  );
}
