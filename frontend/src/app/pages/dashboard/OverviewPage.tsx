import { useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/app/components/PageHeader";
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
  RECENT_READINGS_LIMIT,
  type ReadingsRange,
} from "./overview/overviewModel";
import type { ReadingsDisplay, ReadingsView } from "./overview/ReadingsControls";
import { ReadingsPanel } from "./overview/ReadingsPanel";
import type { SeriesReadingsState } from "./overview/SeriesReadingsBody";
import { historyQueryOptions, TELEMETRY_REFETCH_MS } from "./overview/telemetryQueries";

const INVENTORY_PAGE_SIZE = 100;

export default function OverviewPage() {
  const { user } = useAuthStore();
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [range, setRange] = useState<ReadingsRange>("24h");
  const [view, setView] = useState<ReadingsView>("device");
  const [display, setDisplay] = useState<ReadingsDisplay>("chart");
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<string | null>(null);
  const [requestedVariableCode, setRequestedVariableCode] = useState<string | null>(null);

  const environmentsQuery = useQuery({
    queryKey: ["environments", "operational-overview"],
    queryFn: () => environmentService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: ENVIRONMENT_SORT_BY.NAME,
      sortOrder: "asc",
    }),
  });

  const devicesQuery = useQuery({
    queryKey: ["devices", "operational-overview"],
    queryFn: () => deviceService.getAll({
      page: 1,
      perPage: INVENTORY_PAGE_SIZE,
      sortBy: DEVICE_SORT_BY.NAME,
      sortOrder: "asc",
    }),
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

  // Same key prefixes as the device detail page so the live pulse refreshes the dashboard too.
  const latestQuery = useQuery({
    queryKey: ["telemetry", "latest", deviceId, RECENT_READINGS_LIMIT],
    queryFn: () => environmentalSensorService.getLatest(deviceId!, RECENT_READINGS_LIMIT),
    enabled: telemetryEnabled,
    refetchInterval: TELEMETRY_REFETCH_MS,
  });
  const historyQuery = useQuery(historyQueryOptions(deviceId, range, canReadTelemetry));

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
    queries: environmentDevices.map((device) => historyQueryOptions(device.id, range, environmentEnabled)),
  });
  const environmentHistories: DeviceHistory[] = environmentDevices.map((device, index) => ({
    deviceId: device.id,
    deviceName: deviceLabel(device),
    page: environmentHistory[index]?.data,
  }));
  const deviceHistories: DeviceHistory[] = selectedDevice
    ? [{ deviceId: selectedDevice.id, deviceName: deviceLabel(selectedDevice), page: historyQuery.data }]
    : [];

  // Both views share the variable chips, the range bucketing and the series model.
  const histories = view === "environment" ? environmentHistories : deviceHistories;
  const variables = collectVariables(histories);
  const variable = variables.find((entry) => entry.code === requestedVariableCode)
    ?? variables.find((entry) => entry.code === defaultVariableCode(variables));
  const seriesModel = variable
    ? buildEnvironmentSeries(histories, variable.code, BUCKET_MS[range], view === "device" ? sensorLabel : undefined)
    : { series: [], points: [] };
  const readings: SeriesReadingsState = {
    ...(view === "environment"
      ? {
        loading: environmentHistory.some((query) => query.isLoading),
        failedDevices: environmentHistory.filter((query) => query.isError && !query.data).length,
        deviceCount: environmentDevices.length,
      }
      : {
        loading: historyQuery.isLoading,
        failedDevices: historyQuery.isError && !historyQuery.data ? 1 : 0,
        deviceCount: 1,
      }),
    variables,
    variable,
    ...seriesModel,
    bucketLabel: BUCKET_LABEL[range],
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
            isFetching: environmentsQuery.isFetching,
            onRetry: () => void environmentsQuery.refetch(),
          }}
          devices={devices}
          devicesTotal={devicesQuery.data?.total}
          devicesState={{
            isPending: devicesQuery.isPending,
            isError: devicesQuery.isError,
            hasData: Boolean(devicesQuery.data),
            isFetching: devicesQuery.isFetching,
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
          />
        </div>
      </div>
    </PageHeader>
  );
}
