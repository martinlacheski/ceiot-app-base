import { appApi } from "@/api/appApi";

const base = "/devices/history/devices";
export interface HistoryPage<T> { items: T[]; total: number; page: number; perPage: number; pages: number }
export interface HistoryDevice { serial: string; deviceName?: string | null; environmentId: string; environmentName?: string | null; firstSeen: string | null; lastSeen: string | null; readingsCount: number; operationsCount: number; isFormer: boolean; ownerId?: string | null; ownerName?: string | null }
export interface HistoryReading { id: string; time: string; deviceSerial: string; deviceType: string | null; powerSupplyState: boolean | null; temperatureC: number | null; relativeHumidityPct: number | null; pressureHpa: number | null; uptime: number | null; firmwareVersion: string | null; resetReason: string | null; heapFree: number | null; wifiRssi: number | null; wifiSsid: string | null; wifiIp: string | null; lastError: string | null; deviceDatetime: string | null }
export interface HistoryOperation { id: string; time: string; deviceSerial: string | null; operationType: string; status: string }
export interface HistoryTelemetryVariable { code: string; name: string; unit: string }
export interface HistoryCatalogVariable extends HistoryTelemetryVariable { id: string }
export interface HistoryTelemetrySensor { key: string; sensorCode: string; sensorName: string; variables: HistoryTelemetryVariable[] }
export interface HistoryTelemetryItem { time: string; values: Record<string, Record<string, number | null>> }
export interface HistoryTelemetryPage extends HistoryPage<HistoryTelemetryItem> { sensors: HistoryTelemetrySensor[] }
export type HistorySortOrder = "asc" | "desc";
export interface HistoryCommon { environmentId?: string; search?: string; sortBy?: string; sortOrder?: HistorySortOrder; page?: number; perPage?: number; dateFrom?: string; dateTo?: string }
export interface HistoryDevicesParams extends HistoryCommon { onlyFormer?: boolean; lastSeenFrom?: string; lastSeenTo?: string; ownerId?: string }
export interface HistoryReadingsParams extends HistoryCommon { tempMin?: number; tempMax?: number; humidityMin?: number; humidityMax?: number; pressureMin?: number; pressureMax?: number; hasError?: boolean; firmwareVersion?: string }
export interface HistoryOperationsParams extends HistoryCommon { status?: string; operationType?: string }
export interface HistoryTelemetryParams extends HistoryCommon { variable?: string; min?: number; max?: number }

const cleanSearch = (value?: string) => value?.trim().slice(0, 64) || undefined;
const common = (params: HistoryCommon) => ({
  environment_id: params.environmentId || undefined,
  search: cleanSearch(params.search),
  sort_by: params.sortBy,
  sort_order: params.sortOrder,
  page: params.page,
  per_page: params.perPage,
  utc_offset_minutes: -new Date().getTimezoneOffset(),
});
const page = async <T>(url: string, params: Record<string, unknown>): Promise<HistoryPage<T>> => {
  const { data } = await appApi.get<HistoryPage<T>>(url, { params });
  return data;
};
const serialPath = (serial: string) => `${base}/${encodeURIComponent(serial)}`;

export const deviceHistoryApi = {
  variables: async (): Promise<HistoryCatalogVariable[]> => {
    const { data } = await appApi.get<HistoryCatalogVariable[]>("/sensor-catalog/variables");
    return data;
  },
  devices: (params: HistoryDevicesParams) => page<HistoryDevice>(base, {
    ...common(params), only_former: params.onlyFormer ?? true,
    last_seen_from: params.lastSeenFrom || undefined,
    last_seen_to: params.lastSeenTo || undefined,
    owner_id: params.ownerId || undefined,
  }),
  readings: (serial: string, params: HistoryReadingsParams) => page<HistoryReading>(`${serialPath(serial)}/sensor-readings`, {
    ...common(params), date_from: params.dateFrom || undefined, date_to: params.dateTo || undefined,
    temp_min: params.tempMin, temp_max: params.tempMax,
    humidity_min: params.humidityMin, humidity_max: params.humidityMax,
    pressure_min: params.pressureMin, pressure_max: params.pressureMax,
    has_error: params.hasError, firmware_version: params.firmwareVersion || undefined,
  }),
  telemetry: async (serial: string, params: HistoryTelemetryParams): Promise<HistoryTelemetryPage> => {
    const { data } = await appApi.get<HistoryTelemetryPage>(`${serialPath(serial)}/telemetry`, { params: {
      ...common(params), date_from: params.dateFrom || undefined, date_to: params.dateTo || undefined,
      variable: params.variable || undefined, min: params.min, max: params.max,
    } });
    return data;
  },
  operations: (serial: string, params: HistoryOperationsParams) => page<HistoryOperation>(`${serialPath(serial)}/operations`, {
    ...common(params), date_from: params.dateFrom || undefined, date_to: params.dateTo || undefined,
    status: params.status || undefined,
    operation_type: params.operationType || undefined,
  }),
};
