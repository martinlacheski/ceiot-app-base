import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/app/components/PageHeader";
import { deviceService } from "@/app/services/device.service";
import { environmentService } from "@/app/services/environment.service";
import { environmentalSensorService } from "@/app/services/environmentalSensor.service";
import { DEVICE_SORT_BY } from "@/app/types/device.types";
import { ENVIRONMENT_SORT_BY } from "@/app/types/environment.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { EnvironmentsCard } from "./overview/EnvironmentsCard";
import { FleetStatusCard } from "./overview/FleetStatusCard";
import { OverviewKpis } from "./overview/OverviewKpis";
import {
  countPresence,
  deviceLabel,
  pickSelectedDevice,
  RECENT_READINGS_LIMIT,
  resolveReadingsPeriod,
  type ReadingsRange,
} from "./overview/overviewModel";
import { ReadingsPanel } from "./overview/ReadingsPanel";
import { RecentRecordsCard } from "./overview/RecentRecordsCard";

const INVENTORY_PAGE_SIZE = 100;
/** Fallback refresh; the live pulse invalidates these keys as soon as the device reports. */
const TELEMETRY_REFETCH_MS = 30_000;

export default function OverviewPage() {
  const { user } = useAuthStore();
  const canReadTelemetry = Boolean(user?.isAdmin || user?.permissions?.includes("telemetry:read"));
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [range, setRange] = useState<ReadingsRange>("24h");

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
  const telemetryEnabled = Boolean(deviceId && canReadTelemetry);

  // Same key prefixes as the device detail page so the live pulse refreshes the dashboard too.
  const latestQuery = useQuery({
    queryKey: ["telemetry", "latest", deviceId, RECENT_READINGS_LIMIT],
    queryFn: () => environmentalSensorService.getLatest(deviceId!, RECENT_READINGS_LIMIT),
    enabled: telemetryEnabled,
    refetchInterval: TELEMETRY_REFETCH_MS,
  });
  const historyQuery = useQuery({
    queryKey: ["telemetry", "history", deviceId, range],
    queryFn: () => {
      const { start, end } = resolveReadingsPeriod(range, Date.now());
      return environmentalSensorService.getHistory(deviceId!, start, end);
    },
    enabled: telemetryEnabled,
    refetchInterval: TELEMETRY_REFETCH_MS,
  });

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
