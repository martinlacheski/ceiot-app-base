import { useMutation, useQuery } from "@tanstack/react-query";

import { catalogApi, type Sensor } from "@/admin/pages/sensorCatalog/catalogApi";
import {
  emulatorService,
  type EmulatorTelemetryRequest,
} from "../services/emulator.service";

export interface EmulatorSensorVariable {
  code: string;
  name: string;
  unit: string;
  minValue: number;
  maxValue: number;
}

/** An active device sensor merged with its catalog ranges/units, ready for the emulator controls. */
export interface EmulatorSensor {
  key: string;
  sensorId: string;
  sensorCode: string;
  sensorName: string;
  variables: EmulatorSensorVariable[];
}

export const emulatorKeys = {
  all: ["emulator"] as const,
  sensors: (deviceId: string) =>
    [...emulatorKeys.all, "sensors", deviceId] as const,
};

async function fetchEmulatorSensors(deviceId: string): Promise<EmulatorSensor[]> {
  const deviceSensors = (await emulatorService.getDeviceSensors(deviceId)).filter(
    (sensor) => sensor.isActive,
  );
  const uniqueSensorIds = [...new Set(deviceSensors.map((sensor) => sensor.sensorId))];
  const catalogEntries = await Promise.all(
    uniqueSensorIds.map((sensorId) => catalogApi.get("sensors", sensorId) as Promise<Sensor>),
  );
  const catalogBySensorId = new Map(
    uniqueSensorIds.map((sensorId, index) => [sensorId, catalogEntries[index]]),
  );

  return deviceSensors.flatMap((sensor) => {
    const catalog = catalogBySensorId.get(sensor.sensorId);
    if (!catalog) return [];
    return [
      {
        key: sensor.key,
        sensorId: sensor.sensorId,
        sensorCode: catalog.code,
        sensorName: catalog.name,
        variables: catalog.variables.map((variable) => ({
          code: variable.code,
          name: variable.name,
          unit: variable.unit,
          minValue: variable.minValue,
          maxValue: variable.maxValue,
        })),
      },
    ];
  });
}

/** Active installed sensors of `deviceId`, merged with their catalog variable ranges/units. */
export function useEmulatorSensors(deviceId: string | undefined) {
  return useQuery({
    queryKey: emulatorKeys.sensors(deviceId ?? ""),
    queryFn: () => fetchEmulatorSensors(deviceId!),
    enabled: Boolean(deviceId),
  });
}

export function useSendEmulatorTelemetry() {
  return useMutation({
    mutationFn: ({
      deviceId,
      body,
    }: {
      deviceId: string;
      body: EmulatorTelemetryRequest;
    }) => emulatorService.sendTelemetry(deviceId, body),
  });
}

export function useRequestEmulatorTime() {
  return useMutation({
    mutationFn: (deviceId: string) => emulatorService.requestTime(deviceId),
  });
}
