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
  BUCKET_LABEL,
  BUCKET_MS,
  buildEnvironmentSeries,
  collectVariables,
  defaultVariableCode,
  listDeviceEnvironments,
  sensorLabel,
  type DeviceHistory,
} from "./overview/environmentSeries";
import { OverviewKpis } from "./overview/OverviewKpis";
import {
  countPresence,
  deviceLabel,
  pickSelectedDevice,
  readingsWindow,
  RECENT_READINGS_LIMIT,
  type ReadingsRange,
} from "./overview/overviewModel";
import type { ReadingsDisplay, ReadingsView } from "./overview/ReadingsControls";
import { ReadingsPanel } from "./overview/ReadingsPanel";
import type { SeriesReadingsState } from "./overview/SeriesReadingsBody";
import { historyQueryOptions, liveRefreshOptions } from "./overview/telemetryQueries";
import { useNow } from "./overview/useNow";

const INVENTORY_PAGE_SIZE = 100;

/** Histories of the establishment view as last loaded, with the range they were loaded for. */
interface EnvironmentSnapshot {
  histories: DeviceHistory[];
  range: ReadingsRange;
}

/** Same devices, same cached pages (query data is referentially stable) and same range. */
function isSameSnapshot(snapshot: EnvironmentSnapshot | null, histories: DeviceHistory[], range: ReadingsRange) {
  return snapshot !== null
    && snapshot.range === range
    && snapshot.histories.length === histories.length
    && snapshot.histories.every((history, index) =>
      history.deviceId === histories[index].deviceId && history.page === histories[index].page);
}

export default function OverviewPage() {
  const { user } = useAuthStore();
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [range, setRange] = useState<ReadingsRange>("24h");
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
  const historyQuery = useQuery(historyQueryOptions(deviceId, range, canReadTelemetry, liveConnected));

  // Establishment view: one history query per device, with the per-device keys so the cache is shared.
  const environmentOptions = listDeviceEnvironments(devices);
  const selectedEnvironment = environmentOptions.find((environment) => environment.id === requestedEnvironmentId)
    ?? environmentOptions.find((environment) => environment.id === selectedDevice?.environment?.id)
    ?? environmentOptions[0];
  const environmentDevices = selectedEnvironment
    ? devices.filter((device) => device.environment?.id === selectedEnvironment.id)
    : [];
  const environmentEnabled = view === "environment" && canReadTelemetry;
  const environmentHistory = useQueries({
    queries: environmentDevices.map((device) => historyQueryOptions(device.id, range, environmentEnabled, liveConnected)),
  });
  const environmentHistories: DeviceHistory[] = environmentDevices.map((device, index) => ({
    deviceId: device.id,
    deviceName: deviceLabel(device),
    page: environmentHistory[index]?.data,
  }));
  const deviceHistories: DeviceHistory[] = selectedDevice
    ? [{ deviceId: selectedDevice.id, deviceName: deviceLabel(selectedDevice), page: historyQuery.data }]
    : [];

  // `keepPreviousData` does nothing inside `useQueries` (each key gets a new observer), so the
  // establishment view remembers its last loaded histories and keeps them on screen, dimmed,
  // while another range or establishment has nothing loaded yet.
  const environmentLoaded = environmentHistories.some((history) => history.page);
  const [lastEnvironment, setLastEnvironment] = useState<EnvironmentSnapshot | null>(null);
  if (view === "environment" && environmentLoaded && !isSameSnapshot(lastEnvironment, environmentHistories, range)) {
    setLastEnvironment({ histories: environmentHistories, range });
  }
  const environmentLoading = environmentHistory.some((query) => query.isLoading);
  const staleEnvironment = view === "environment" && !environmentLoaded && environmentLoading ? lastEnvironment : null;

  // Both views share the variable chips, the range bucketing and the series model.
  const shown: EnvironmentSnapshot = staleEnvironment
    ?? { histories: view === "environment" ? environmentHistories : deviceHistories, range };
  const { histories } = shown;
  // Trim at render time: a quiet device sends nothing that would trim its cached history.
  const timeWindow = readingsWindow(shown.range, now);
  const variables = collectVariables(histories);
  const variable = variables.find((entry) => entry.code === requestedVariableCode)
    ?? variables.find((entry) => entry.code === defaultVariableCode(variables));
  const seriesModel = variable
    ? buildEnvironmentSeries(histories, variable.code, BUCKET_MS[shown.range], {
      label: view === "device" ? sensorLabel : undefined,
      since: timeWindow.start,
    })
    : { series: [], points: [] };
  const readings: SeriesReadingsState = {
    ...(view === "environment"
      ? {
        loading: environmentLoading,
        failedDevices: environmentHistory.filter((query) => query.isError && !query.data).length,
        deviceCount: histories.length,
      }
      : {
        loading: historyQuery.isLoading,
        failedDevices: historyQuery.isError && !historyQuery.data ? 1 : 0,
        deviceCount: 1,
      }),
    variables,
    variable,
    ...seriesModel,
    bucketLabel: BUCKET_LABEL[shown.range],
    range: shown.range,
    timeWindow,
    stale: staleEnvironment !== null,
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
            range={range}
            onRangeChange={setRange}
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
