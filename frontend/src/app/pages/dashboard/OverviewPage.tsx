import { useRef, useState } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/app/components/PageHeader";
import { useLivePulseStatus } from "@/app/live/livePulse.store";
import { deviceService } from "@/app/services/device.service";
import { environmentService } from "@/app/services/environment.service";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { DEVICE_SORT_BY } from "@/app/types/device.types";
import { ENVIRONMENT_SORT_BY } from "@/app/types/environment.types";
import { useAuthStore } from "@/auth/store/auth.store";
import {
  buildEnvironmentSeries,
  collectVariables,
  defaultVariableCode,
  listDeviceEnvironments,
  sensorLabel,
  type DeviceAggregate,
} from "./overview/environmentSeries";
import { OverviewKpis } from "./overview/OverviewKpis";
import {
  countPresence,
  deviceLabel,
  effectiveAggregation,
  periodQueryKey,
  periodWindow,
  pickSelectedDevice,
  presetPeriod,
  RECENT_READINGS_LIMIT,
  type AggregateFunction,
  type AggregationLevel,
  type ReadingsPeriod,
  type ReadingsRange,
} from "./overview/overviewModel";
import type { ReadingsDisplay, ReadingsView } from "./overview/ReadingsControls";
import { ReadingsPanel, type ReadingsNavigation } from "./overview/ReadingsPanel";
import type { SeriesReadingsState } from "./overview/SeriesReadingsBody";
import { aggregateQueryOptions, liveRefreshOptions } from "./overview/telemetryQueries";
import { useNow } from "./overview/useNow";

const INVENTORY_PAGE_SIZE = 100;

/** Aggregates of the establishment view as last loaded, with the period and bucket they were loaded for. */
interface EnvironmentSnapshot {
  aggregates: DeviceAggregate[];
  period: ReadingsPeriod;
  /** Period and bucket parts of the query key. */
  windowKey: string;
}

/** Same devices, same cached data (query data is referentially stable), same period and bucket. */
function isSameSnapshot(snapshot: EnvironmentSnapshot | null, aggregates: DeviceAggregate[], windowKey: string) {
  return snapshot !== null
    && snapshot.windowKey === windowKey
    && snapshot.aggregates.length === aggregates.length
    && snapshot.aggregates.every((aggregate, index) =>
      aggregate.deviceId === aggregates[index].deviceId && aggregate.data === aggregates[index].data);
}

export default function OverviewPage() {
  const { user } = useAuthStore();
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReadingsPeriod>(() => presetPeriod("24h"));
  // The preset "Ahora" returns to after moving to past windows.
  const [livePreset, setLivePreset] = useState<ReadingsRange>("24h");
  const [requestedAggregation, setRequestedAggregation] = useState<AggregationLevel>("auto");
  const [fn, setFn] = useState<AggregateFunction>("avg");
  const [showBand, setShowBand] = useState(true);
  const [view, setView] = useState<ReadingsView>("device");
  const [display, setDisplay] = useState<ReadingsDisplay>("chart");
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<string | null>(null);
  const [requestedVariableCode, setRequestedVariableCode] = useState<string | null>(null);
  // The live pulse updates the caches in place; poll slowly only while it is down.
  const liveConnected = useLivePulseStatus((status) => status.connected);
  const refreshOptions = liveRefreshOptions(liveConnected);
  const now = useNow();

  const environmentsQuery = useQuery({
    queryKey: ["environments", "operational-overview"],
    queryFn: () => environmentService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: ENVIRONMENT_SORT_BY.NAME,
      sortOrder: "asc",
    }),
    ...refreshOptions,
  });

  const devicesQuery = useQuery({
    queryKey: ["devices", "operational-overview"],
    queryFn: () => deviceService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: DEVICE_SORT_BY.NAME,
      sortOrder: "asc",
    }),
    ...refreshOptions,
  });

  const environments = environmentsQuery.data?.items ?? [];
  const devices = devicesQuery.data?.items ?? [];
  const presence = countPresence(devices);
  const selectedDevice = pickSelectedDevice(devices, requestedDeviceId);
  const deviceId = selectedDevice?.id;
  // Pin the default pick so a presence change on refresh does not switch the panel's device.
  if (deviceId && requestedDeviceId !== deviceId) {
    setRequestedDeviceId(deviceId);
  }
  const telemetryEnabled = Boolean(deviceId && canReadTelemetry);

  // Same key prefixes as the device detail page so the live pulse patches the dashboard too.
  // The records table is the only consumer of the latest rows: fetch them only while it is shown.
  const latestQuery = useQuery({
    queryKey: ["telemetry", "latest", deviceId, RECENT_READINGS_LIMIT],
    queryFn: () => environmentalSensorService.getLatest(deviceId!, RECENT_READINGS_LIMIT),
    enabled: telemetryEnabled && view === "device" && display === "table",
    placeholderData: keepPreviousData,
    ...refreshOptions,
  });
  // Current values come from the Redis live state; the pulse patches this cache too.
  const liveQuery = useQuery({
    queryKey: ["telemetry", "live", deviceId],
    queryFn: () => environmentalSensorService.getLive(deviceId!),
    enabled: telemetryEnabled,
    placeholderData: keepPreviousData,
    ...refreshOptions,
  });
  const timeWindow = periodWindow(period, now);
  // A level that does not fit the period falls back to automatic; it comes back with a shorter period.
  const aggregation = effectiveAggregation(requestedAggregation, timeWindow.end - timeWindow.start);
  const windowKey = JSON.stringify([...periodQueryKey(period), aggregation]);
  const aggregateQuery = useQuery(aggregateQueryOptions(deviceId, period, aggregation, canReadTelemetry, liveConnected));

  // Establishment view: one aggregate query per device, with the per-device keys so the cache is shared.
  const environmentOptions = listDeviceEnvironments(devices);
  const selectedEnvironment = environmentOptions.find((environment) => environment.id === requestedEnvironmentId)
    ?? environmentOptions.find((environment) => environment.id === selectedDevice?.environment?.id)
    ?? environmentOptions[0];
  const environmentDevices = selectedEnvironment
    ? devices.filter((device) => device.environment?.id === selectedEnvironment.id)
    : [];
  const environmentEnabled = view === "environment" && canReadTelemetry;
  const environmentAggregate = useQueries({
    queries: environmentDevices.map((device) =>
      aggregateQueryOptions(device.id, period, aggregation, environmentEnabled, liveConnected)),
  });
  const environmentAggregates: DeviceAggregate[] = environmentDevices.map((device, index) => ({
    deviceId: device.id,
    deviceName: deviceLabel(device),
    data: environmentAggregate[index]?.data,
  }));
  const deviceAggregates: DeviceAggregate[] = selectedDevice
    ? [{ deviceId: selectedDevice.id, deviceName: deviceLabel(selectedDevice), data: aggregateQuery.data }]
    : [];

  // `keepPreviousData` does nothing inside `useQueries` (each key gets a new observer), so the
  // establishment view remembers its last loaded aggregates and keeps them on screen, dimmed,
  // while another period, bucket or establishment has nothing loaded yet.
  const environmentLoaded = environmentAggregates.some((aggregate) => aggregate.data);
  const [lastEnvironment, setLastEnvironment] = useState<EnvironmentSnapshot | null>(null);
  if (view === "environment" && environmentLoaded && !isSameSnapshot(lastEnvironment, environmentAggregates, windowKey)) {
    setLastEnvironment({ aggregates: environmentAggregates, period, windowKey });
  }
  const environmentLoading = environmentAggregate.some((query) => query.isLoading);
  const staleEnvironment = view === "environment" && !environmentLoaded && environmentLoading ? lastEnvironment : null;

  // Both views share the variable chips, the aggregation controls and the series model.
  const shown: EnvironmentSnapshot = staleEnvironment
    ?? { aggregates: view === "environment" ? environmentAggregates : deviceAggregates, period, windowKey };
  const { aggregates } = shown;
  // Trim at render time: a quiet device sends nothing that would trim its cached buckets.
  const shownWindow = periodWindow(shown.period, now);
  const variables = collectVariables(aggregates);
  const variable = variables.find((entry) => entry.code === requestedVariableCode)
    ?? variables.find((entry) => entry.code === defaultVariableCode(variables));
  const seriesModel = variable
    ? buildEnvironmentSeries(aggregates, variable.code, {
      label: view === "device" ? sensorLabel : undefined,
      fn,
      since: shownWindow.start,
    })
    : { series: [], points: [] };
  const readings: SeriesReadingsState = {
    ...(view === "environment"
      ? {
        loading: environmentLoading,
        failedDevices: environmentAggregate.filter((query) => query.isError && !query.data).length,
        deviceCount: aggregates.length,
      }
      : {
        loading: aggregateQuery.isLoading,
        failedDevices: aggregateQuery.isError && !aggregateQuery.data ? 1 : 0,
        deviceCount: 1,
      }),
    variables,
    variable,
    ...seriesModel,
    bucket: aggregates.find((aggregate) => aggregate.data)?.data?.bucket,
    fn,
    timeWindow: shownWindow,
    windowKey: JSON.stringify([view, view === "device" ? deviceId : selectedEnvironment?.id, shown.windowKey]),
    stale: staleEnvironment !== null,
  };

  const changePeriod = (next: ReadingsPeriod) => {
    setPeriod(next);
    if (next.kind === "preset") setLivePreset(next.range);
  };
  const navigation: ReadingsNavigation = {
    period,
    now,
    onPeriodChange: changePeriod,
    onLive: () => setPeriod(presetPeriod(livePreset)),
    aggregation,
    onAggregationChange: setRequestedAggregation,
    fn,
    onFnChange: setFn,
    showBand,
    onShowBandChange: setShowBand,
  };

  const readingsRef = useRef<HTMLDivElement>(null);
  // Picking a device or an establishment in a KPI card drives the readings card and brings it into view.
  const revealReadings = () => readingsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  const showDevice = (id: string) => {
    setRequestedDeviceId(id);
    setView("device");
    revealReadings();
  };
  const showEnvironment = (id: string) => {
    setRequestedEnvironmentId(id);
    setView("environment");
    revealReadings();
  };

  const devicesStatus = devicesQuery.isPending
    ? "loading"
    : devicesQuery.isError && !devicesQuery.data ? "error" : "ready";

  return (
    <PageHeader title="Resumen operativo" subtitle="Estado de tu flota y últimas lecturas">
      <div className="space-y-4 pt-4">
        <OverviewKpis
          environments={environments}
          environmentsTotal={environmentsQuery.data?.total}
          environmentsState={{
            isPending: environmentsQuery.isPending,
            isError: environmentsQuery.isError,
            hasData: Boolean(environmentsQuery.data),
            onRetry: () => void environmentsQuery.refetch(),
          }}
          devices={devices}
          devicesTotal={devicesQuery.data?.total}
          devicesState={{
            isPending: devicesQuery.isPending,
            isError: devicesQuery.isError,
            hasData: Boolean(devicesQuery.data),
            onRetry: () => void devicesQuery.refetch(),
          }}
          presence={presence}
          onSelectDevice={showDevice}
          onSelectEnvironment={showEnvironment}
        />
        <div ref={readingsRef} className="min-w-0 scroll-mt-4">
          <ReadingsPanel
            devicesStatus={devicesStatus}
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setRequestedDeviceId}
            environments={environmentOptions}
            selectedEnvironmentId={selectedEnvironment?.id}
            onSelectEnvironment={setRequestedEnvironmentId}
            navigation={navigation}
            view={view}
            onViewChange={setView}
            display={display}
            onDisplayChange={setDisplay}
            onSelectVariable={setRequestedVariableCode}
            canReadTelemetry={canReadTelemetry}
            readings={readings}
            latest={{ page: latestQuery.data, isLoading: latestQuery.isLoading, isError: latestQuery.isError }}
            current={{ live: liveQuery.data, isLoading: liveQuery.isLoading, isError: liveQuery.isError }}
          />
        </div>
      </div>
    </PageHeader>
  );
}
