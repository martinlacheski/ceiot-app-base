import { appApi } from "@/api/appApi";

const BASE_URL = "/devices";

/** Mirrors backend `DeviceSensorRead` (`app/api/sensor_catalog/schemas.py`). */
export interface DeviceSensor {
  id: string;
  deviceId: string;
  sensorId: string;
  key: string;
  config: Record<string, unknown>;
  isActive: boolean;
  installedAt: string | null;
  removedAt: string | null;
}

/** Mirrors backend `EmulatorTelemetryRequest` (`app/api/device/emulator/router.py`). */
export interface EmulatorTelemetryRequest {
  sensors: Record<string, Record<string, number>>;
  uptime?: number;
  firmwareVersion?: string;
}

/** Mirrors backend `EmulatorTelemetryResponse`. `payload` is a raw MQTT passthrough (snake_case). */
export interface EmulatorTelemetryResponse {
  topic: string;
  payload: {
    sensors: Record<string, Record<string, number>>;
    firmware_version: string;
    uptime?: number;
  };
}

/** Mirrors backend `EmulatorTimeRequestResponse`. */
export interface EmulatorTimeRequestResponse {
  reqId: string;
  topic: string;
}

export const emulatorService = {
  getDeviceSensors: async (deviceId: string): Promise<DeviceSensor[]> => {
    const { data } = await appApi.get<DeviceSensor[]>(
      `${BASE_URL}/${deviceId}/sensors`,
    );
    return data;
  },

  sendTelemetry: async (
    deviceId: string,
    body: EmulatorTelemetryRequest,
  ): Promise<EmulatorTelemetryResponse> => {
    const { data } = await appApi.post<EmulatorTelemetryResponse>(
      `${BASE_URL}/${deviceId}/emulator/telemetry`,
      body,
    );
    return data;
  },

  requestTime: async (
    deviceId: string,
  ): Promise<EmulatorTimeRequestResponse> => {
    const { data } = await appApi.post<EmulatorTimeRequestResponse>(
      `${BASE_URL}/${deviceId}/emulator/time-request`,
    );
    return data;
  },
};
