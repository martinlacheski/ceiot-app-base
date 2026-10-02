import { appApi } from "@/api/appApi";
import type { DeviceTypeCatalog } from "@/app/types/device.types";
import type { DeviceTypePayload } from "./deviceTypeValidation";

export type DeviceTypeStatusFilter = "all" | "active" | "inactive";

export interface Page<T> { items: T[]; total: number; page: number; perPage: number; pages: number }
export interface DeviceTypeListParams {
  page: number;
  perPage: number;
  search?: string;
  status?: DeviceTypeStatusFilter;
  hardwareModel?: string;
  sensorId?: string;
  sort?: string;
}

export const deviceTypesApi = {
  async list(params: DeviceTypeListParams): Promise<Page<DeviceTypeCatalog>> {
    const status = params.status ?? "all";
    const { data } = await appApi.get<Page<DeviceTypeCatalog>>("/devices/types", {
      params: {
        page: params.page,
        per_page: params.perPage,
        ...(status === "all" ? { include_inactive: true } : { is_active: status === "active" }),
        ...(params.search ? { search: params.search } : {}),
        ...(params.hardwareModel ? { hardware_model: params.hardwareModel } : {}),
        ...(params.sensorId ? { sensor_id: params.sensorId } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
      },
    });
    return data;
  },
  async get(id: string): Promise<DeviceTypeCatalog> {
    const { data } = await appApi.get<DeviceTypeCatalog>(`/devices/types/${id}`);
    return data;
  },
  async create(body: DeviceTypePayload): Promise<DeviceTypeCatalog> {
    const { data } = await appApi.post<DeviceTypeCatalog>("/devices/types", body);
    return data;
  },
  async update(id: string, body: Partial<DeviceTypePayload> & { isActive?: boolean }): Promise<DeviceTypeCatalog> {
    const { data } = await appApi.put<DeviceTypeCatalog>(`/devices/types/${id}`, body);
    return data;
  },
  async deactivate(id: string): Promise<void> {
    await appApi.delete(`/devices/types/${id}`);
  },
};
