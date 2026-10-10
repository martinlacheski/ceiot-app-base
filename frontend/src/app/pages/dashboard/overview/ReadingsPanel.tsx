import { ArrowUpRight, Cpu, Link as LinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Device } from "@/app/types/device.types";
import type { TelemetryPage } from "@/app/types/environmentalSensor.types";
import { EnvironmentalReadingsSection } from "@/components/dashboard/EnvironmentalReadingsSection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deviceLabel, type ReadingsRange } from "./overviewModel";
import { Notice, RangePresets, ReadingsViewToggle, TelemetryPermissionNotice, type ReadingsView } from "./ReadingsControls";

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
  view: ReadingsView;
  onViewChange: (view: ReadingsView) => void;
  /** Rendered instead of the per-device readings when the establishment view is active. */
  environmentView: ReactNode;
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
        <RangePresets range={range} onRangeChange={onRangeChange} />
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
  const { devicesStatus, devices, selectedDevice, canReadTelemetry, telemetry, view, onViewChange, environmentView } = props;

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
      <ReadingsViewToggle view={view} onViewChange={onViewChange} />
      {view === "environment" ? environmentView : (
        <>
          <ReadingsToolbar {...props} selectedDevice={selectedDevice} />
          {canReadTelemetry ? <EnvironmentalReadingsSection {...telemetry} /> : <TelemetryPermissionNotice />}
        </>
      )}
    </section>
  );
}
