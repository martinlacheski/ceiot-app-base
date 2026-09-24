import { appApi } from "@/api/appApi";
import type { DeviceSensor, SensorCatalogModel, TelemetryPage } from "../types/environmentalSensor.types";

export interface DeviceSensorCreate {
  sensorId: string;
  key?: string;
  config: Record<string, unknown>;
}

export interface DeviceSensorUpdate {
  key?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export const environmentalSensorService = {
  async getCatalog(): Promise<SensorCatalogModel[]> {
    const { data } = await appApi.get<SensorCatalogModel[]>("/sensor-catalog/sensors");
    return data;
  },
  async getDeviceSensors(deviceId: string): Promise<DeviceSensor[]> {
    const { data } = await appApi.get<DeviceSensor[]>(`/devices/${deviceId}/sensors`);
    return data;
  },
  async addDeviceSensor(deviceId: string, payload: DeviceSensorCreate): Promise<DeviceSensor> {
    const { data } = await appApi.post<DeviceSensor>(`/devices/${deviceId}/sensors`, payload);
    return data;
  },
  async updateDeviceSensor(deviceId: string, id: string, payload: DeviceSensorUpdate): Promise<DeviceSensor> {
    const { data } = await appApi.patch<DeviceSensor>(`/devices/${deviceId}/sensors/${id}`, payload);
    return data;
  },
  async removeDeviceSensor(deviceId: string, id: string): Promise<DeviceSensor> {
    const { data } = await appApi.delete<DeviceSensor>(`/devices/${deviceId}/sensors/${id}`);
    return data;
  },
  async getLatest(deviceId: string, limit?: number): Promise<TelemetryPage> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    const { data } = await appApi.get<TelemetryPage>(`/devices/${deviceId}/telemetry/latest`, { params });
    return data;
  },
  async getHistory(deviceId: string, start: string, end: string, page = 1, perPage = 1000): Promise<TelemetryPage> {
    const params = new URLSearchParams({ start, end, page: String(page), per_page: String(perPage) });
    const { data } = await appApi.get<TelemetryPage>(`/devices/${deviceId}/telemetry/history`, { params });
    return data;
  },
};
