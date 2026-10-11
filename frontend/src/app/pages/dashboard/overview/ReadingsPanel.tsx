import { ArrowUpRight, Building2, Cpu, Link as LinkIcon } from "lucide-react";
import { Link } from "react-router";

import type { Device } from "@/app/types/device.types";
import type { LiveTelemetry, TelemetryPage } from "@/app/types/environmentalSensor.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrentValuesStrip } from "./CurrentValuesStrip";
import { LatestRecordsTable } from "./LatestRecordsTable";
import {
  canShowBand,
  deviceLabel,
  periodWindow,
  type AggregateFunction,
  type AggregationLevel,
  type ReadingsPeriod,
} from "./overviewModel";
import { PeriodControls } from "./PeriodControls";
import {
  AggregationSelect,
  BandToggle,
  DisplayToggle,
  FunctionToggle,
  Notice,
  NoticeContent,
  ReadingsViewToggle,
  TelemetryPermissionNotice,
  VariableChips,
  type ReadingsDisplay,
  type ReadingsView,
} from "./ReadingsControls";
import { SeriesReadingsBody, type SeriesReadingsState } from "./SeriesReadingsBody";
import { useHiddenSeries, type HiddenSeries } from "./useHiddenSeries";

export interface LatestReadingsState {
  page?: TelemetryPage;
  isLoading: boolean;
  isError: boolean;
}

/** Period, aggregation level, function and band of the readings, with their setters. */
export interface ReadingsNavigation {
  period: ReadingsPeriod;
  /** Current time, refreshed every minute. */
  now: number;
  onPeriodChange: (period: ReadingsPeriod) => void;
  /** Back to the live preset last used. */
  onLive: () => void;
  /** Requested level (automatic when the chosen one does not fit the period). */
  aggregation: AggregationLevel;
  onAggregationChange: (level: AggregationLevel) => void;
  fn: AggregateFunction;
  onFnChange: (fn: AggregateFunction) => void;
  showBand: boolean;
  onShowBandChange: (show: boolean) => void;
}

export interface LiveReadingsState {
  live?: LiveTelemetry;
  isLoading: boolean;
  isError: boolean;
}

interface ReadingsPanelProps {
  devicesStatus: "loading" | "error" | "ready";
  devices: Device[];
  selectedDevice?: Device;
  onSelectDevice: (deviceId: string) => void;
  environments: Array<{ id: string; name: string }>;
  selectedEnvironmentId?: string;
  onSelectEnvironment: (environmentId: string) => void;
  navigation: ReadingsNavigation;
  view: ReadingsView;
  onViewChange: (view: ReadingsView) => void;
  display: ReadingsDisplay;
  onDisplayChange: (display: ReadingsDisplay) => void;
  onSelectVariable: (variableCode: string) => void;
  canReadTelemetry: boolean;
  /** History of the active view: the selected device or the selected establishment. */
  readings: SeriesReadingsState;
  /** Recent raw readings of the selected device (records table). */
  latest: LatestReadingsState;
  /** Live state of the selected device (current values strip). */
  current: LiveReadingsState;
}

const SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

function ReadingsToolbar(props: ReadingsPanelProps & { selectedDevice: Device }) {
  const {
    devices, selectedDevice, onSelectDevice, environments, selectedEnvironmentId, onSelectEnvironment,
    navigation, view, onViewChange, display, onDisplayChange, canReadTelemetry, readings,
  } = props;
  const { start, end } = periodWindow(navigation.period, navigation.now);
  // The device records table shows raw readings: the aggregation level does not apply to it.
  const aggregated = canReadTelemetry && !(view === "device" && display === "table");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ReadingsViewToggle view={view} onViewChange={onViewChange} />
      {view === "device" ? (
        <div className="min-w-44 flex-1 sm:max-w-xs">
          <label htmlFor="overview-device" className="sr-only">Dispositivo</label>
          <select
            id="overview-device"
            className={SELECT_CLASS}
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
      ) : environments.length > 0 && (
        <div className="min-w-44 flex-1 sm:max-w-xs">
          <label htmlFor="overview-environment" className="sr-only">Establecimiento</label>
          <select
            id="overview-environment"
            className={SELECT_CLASS}
            value={selectedEnvironmentId}
            onChange={(event) => onSelectEnvironment(event.target.value)}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>{environment.name}</option>
            ))}
          </select>
        </div>
      )}
      <PeriodControls
        period={navigation.period}
        now={navigation.now}
        onPeriodChange={navigation.onPeriodChange}
        onLive={navigation.onLive}
      />
      {aggregated && (
        <AggregationSelect
          value={navigation.aggregation}
          resolved={readings.bucket}
          spanMs={end - start}
          onChange={navigation.onAggregationChange}
        />
      )}
      {canReadTelemetry && <DisplayToggle display={display} onDisplayChange={onDisplayChange} />}
      {view === "device" && (
        <Button asChild variant="outline" size="sm" className="h-9">
          <Link to={`/app/devices/${selectedDevice.id}`}>
            Ver detalle
            <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}

function ReadingsBody(props: ReadingsPanelProps & { selectedDevice: Device; hidden: HiddenSeries }) {
  const {
    selectedDevice, environments, view, display, onSelectVariable, canReadTelemetry, readings, latest, current, hidden, navigation,
  } = props;
  const bandAvailable = canShowBand(navigation.fn, readings.series.length - hidden.hiddenCount);

  if (!canReadTelemetry) return <TelemetryPermissionNotice />;
  if (view === "environment" && environments.length === 0) {
    return (
      <NoticeContent icon={Building2} title="Ningún dispositivo está asignado a un establecimiento.">
        <p className="max-w-sm text-sm text-muted-foreground">
          Asigná tus dispositivos a un establecimiento para comparar sus sensores en un solo gráfico.
        </p>
      </NoticeContent>
    );
  }
  if (view === "device" && display === "table") {
    return <LatestRecordsTable deviceId={selectedDevice.id} {...latest} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {readings.variables.length > 0 && (
          <div className="min-w-0 flex-1">
            <VariableChips variables={readings.variables} selected={readings.variable?.code} onSelect={onSelectVariable} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FunctionToggle value={navigation.fn} onChange={navigation.onFnChange} />
          {navigation.fn === "avg" && display === "chart" && (
            <BandToggle checked={navigation.showBand} available={bandAvailable} onChange={navigation.onShowBandChange} />
          )}
        </div>
      </div>
      {view === "device" && (
        <CurrentValuesStrip
          {...current}
          selectedVariable={readings.variable?.code}
          onSelectVariable={onSelectVariable}
        />
      )}
      <SeriesReadingsBody
        scope={view}
        display={display}
        readings={readings}
        hidden={hidden}
        showBand={navigation.showBand && bandAvailable}
      />
    </>
  );
}

/** One card holding the whole readings area: toolbar, variable chips and the chart or table. */
export function ReadingsPanel(props: ReadingsPanelProps) {
  const { devicesStatus, devices, selectedDevice } = props;
  // Lives here so the hidden series survive the switch to the raw records table and back.
  const hidden = useHiddenSeries(props.readings.series);

  if (devicesStatus === "loading") {
    return (
      <div aria-busy="true">
        <Skeleton className="h-80 w-full rounded-xl" />
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
    <Card role="region" aria-label="Lecturas" className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <ReadingsToolbar {...props} selectedDevice={selectedDevice} />
        <ReadingsBody {...props} selectedDevice={selectedDevice} hidden={hidden} />
      </CardContent>
    </Card>
  );
}
