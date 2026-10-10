import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { environmentService } from "@/app/services/environment.service";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { DEVICE_SORT_BY } from "@/app/types/device.types";
import { ENVIRONMENT_SORT_BY } from "@/app/types/environment.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { EnvironmentReadingsView } from "./overview/EnvironmentReadingsView";
import {
  BUCKET_LABEL,
  BUCKET_MS,
  buildEnvironmentSeries,
  collectVariables,
  defaultVariableCode,
  listDeviceEnvironments,
} from "./overview/environmentSeries";
import { EnvironmentsCard } from "./overview/EnvironmentsCard";
import { FleetStatusCard } from "./overview/FleetStatusCard";
import { OverviewKpis } from "./overview/OverviewKpis";
import {
  countPresence,
  deviceLabel,
  pickSelectedDevice,
  RECENT_READINGS_LIMIT,
  type ReadingsRange,
} from "./overview/overviewModel";
import type { ReadingsView } from "./overview/ReadingsControls";
import { ReadingsPanel } from "./overview/ReadingsPanel";
import { RecentRecordsCard } from "./overview/RecentRecordsCard";
import { historyQueryOptions, TELEMETRY_REFETCH_MS } from "./overview/telemetryQueries";

const INVENTORY_PAGE_SIZE = 100;

export default function OverviewPage() {
  const { user } = useAuthStore();
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [range, setRange] = useState<ReadingsRange>("24h");
  const [view, setView] = useState<ReadingsView>("device");
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
  const histories = environmentDevices.map((device, index) => ({
    deviceId: device.id,
    deviceName: deviceLabel(device),
    page: environmentHistory[index]?.data,
  }));
  const variables = collectVariables(histories);
  const variable = variables.find((entry) => entry.code === requestedVariableCode)
    ?? variables.find((entry) => entry.code === defaultVariableCode(variables));
  const environmentSeries = variable
    ? buildEnvironmentSeries(histories, variable.code, BUCKET_MS[range])
    : { series: [], points: [] };

  const devicesStatus = devicesQuery.isPending
    ? "loading"
    : devicesQuery.isError && !devicesQuery.data ? "error" : "ready";

  return (
    <PageHeader title="Resumen operativo" subtitle="Estado de tu flota y últimas lecturas">
      <div className="space-y-4 pt-4">
        <OverviewKpis
          environmentsTotal={environmentsQuery.data?.total}
          environmentsLoading={environmentsQuery.isPending}
          devicesTotal={devicesQuery.data?.total}
          devicesShown={devices.length}
          devicesLoading={devicesQuery.isPending}
          devicesAvailable={Boolean(devicesQuery.data)}
          presence={presence}
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <ReadingsPanel
              devicesStatus={devicesStatus}
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={setRequestedDeviceId}
              range={range}
              onRangeChange={setRange}
              canReadTelemetry={canReadTelemetry}
              telemetry={{
                latest: latestQuery.data,
                history: historyQuery.data,
                latestLoading: latestQuery.isLoading,
                historyLoading: historyQuery.isLoading,
                latestError: latestQuery.isError,
                historyError: historyQuery.isError,
              }}
              view={view}
              onViewChange={setView}
              environmentView={(
                <EnvironmentReadingsView
                  environments={environmentOptions}
                  selectedEnvironmentId={selectedEnvironment?.id}
                  onSelectEnvironment={setRequestedEnvironmentId}
                  range={range}
                  onRangeChange={setRange}
                  onSelectVariable={setRequestedVariableCode}
                  canReadTelemetry={canReadTelemetry}
                  readings={{
                    loading: environmentHistory.some((query) => query.isLoading),
                    failedDevices: environmentHistory.filter((query) => query.isError && !query.data).length,
                    deviceCount: environmentDevices.length,
                    variables,
                    variable,
                    ...environmentSeries,
                    bucketLabel: BUCKET_LABEL[range],
                  }}
                />
              )}
            />
            {selectedDevice && canReadTelemetry && (
              <RecentRecordsCard
                deviceId={selectedDevice.id}
                deviceName={deviceLabel(selectedDevice)}
                page={latestQuery.data}
                isLoading={latestQuery.isLoading}
                isError={latestQuery.isError}
              />
            )}
          </div>
          <div className="min-w-0 space-y-4">
            <FleetStatusCard
              devices={devices}
              total={devicesQuery.data?.total}
              isPending={devicesQuery.isPending}
              isError={devicesQuery.isError}
              hasData={Boolean(devicesQuery.data)}
              isFetching={devicesQuery.isFetching}
              onRetry={() => void devicesQuery.refetch()}
            />
            <EnvironmentsCard
              environments={environments}
              total={environmentsQuery.data?.total}
              isPending={environmentsQuery.isPending}
              isError={environmentsQuery.isError}
              hasData={Boolean(environmentsQuery.data)}
              isFetching={environmentsQuery.isFetching}
              onRetry={() => void environmentsQuery.refetch()}
            />
          </div>
        </div>
      </div>
    </PageHeader>
  );
}
