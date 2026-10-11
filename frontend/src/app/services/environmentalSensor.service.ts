import { appApi } from "@/api/appApi";
import type {
  AggregateBucket,
  AggregateTelemetry,
  DailyTelemetry,
  DeviceSensor,
  LiveTelemetry,
  SensorCatalogModel,
  TelemetryPage,
} from "../types/environmentalSensor.types";

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

export interface AggregateQuery {
  start: string;
  end: string;
  bucket: AggregateBucket | "auto";
  /** Browser offset from UTC (local = UTC + offset): buckets start at local midnight. */
  utcOffsetMinutes: number;
  /** Upper bound of buckets when `bucket` is `auto`. */
  maxPoints?: number;
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
  /** Current values and health of a device, from the Redis live cache (database fallback). */
  async getLive(deviceId: string): Promise<LiveTelemetry> {
    const { data } = await appApi.get<LiveTelemetry>(`/devices/${deviceId}/telemetry/live`);
    return data;
  },
  async getHistory(deviceId: string, start: string, end: string, page = 1, perPage = 1000): Promise<TelemetryPage> {
    const params = new URLSearchParams({ start, end, page: String(page), per_page: String(perPage) });
    const { data } = await appApi.get<TelemetryPage>(`/devices/${deviceId}/telemetry/history`, { params });
    return data;
  },
  async getDaily(deviceId: string, start: string, end: string, utcOffsetMinutes: number): Promise<DailyTelemetry> {
    const params = new URLSearchParams({ start, end, utc_offset_minutes: String(utcOffsetMinutes) });
    const { data } = await appApi.get<DailyTelemetry>(`/devices/${deviceId}/telemetry/daily`, { params });
    return data;
  },
  /** avg/min/max/count per time bucket, aggregated by the server. */
  async getAggregate(deviceId: string, query: AggregateQuery): Promise<AggregateTelemetry> {
    const params = new URLSearchParams({
      start: query.start,
      end: query.end,
      bucket: query.bucket,
      utc_offset_minutes: String(query.utcOffsetMinutes),
    });
    if (query.maxPoints !== undefined) params.set("max_points", String(query.maxPoints));
    const { data } = await appApi.get<AggregateTelemetry>(`/devices/${deviceId}/telemetry/aggregate`, { params });
    return data;
  },
};
