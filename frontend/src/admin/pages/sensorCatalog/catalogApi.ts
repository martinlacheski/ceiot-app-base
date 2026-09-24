import { appApi } from "@/api/appApi";

export type CatalogKind = "sensors" | "variables";
export interface Variable { id: string; code: string; name: string; unit: string; description: string | null; isActive: boolean }
export interface SensorVariable { variableId: string; code: string; name: string; unit: string; minValue: number; maxValue: number; accuracy: string; resolution: string }
export interface Sensor { id: string; code: string; name: string; manufacturer: string; description: string | null; isActive: boolean; variables: SensorVariable[] }
export interface SensorVariableInput { variableId: string; minValue: number; maxValue: number; accuracy: string; resolution: string }
export interface Page<T> { items: T[]; total: number; page: number; perPage: number; pages: number }
export interface ListParams { page: number; perPage: number; search?: string; isActive?: boolean; sort?: string }

export const catalogApi = {
  async list<K extends CatalogKind>(kind: K, params: ListParams): Promise<Page<K extends "sensors" ? Sensor : Variable>> {
    const { data } = await appApi.get(`/sensor-catalog/${kind}`, { params: {
      page: params.page, per_page: params.perPage, ...(params.search ? { search: params.search } : {}),
      ...(params.isActive === undefined ? {} : { is_active: params.isActive }), ...(params.sort ? { sort: params.sort } : {}),
    } });
    return data;
  },
  async get(kind: CatalogKind, id: string): Promise<Sensor | Variable> {
    const { data } = await appApi.get(`/sensor-catalog/${kind}/${id}`);
    return data;
  },
  async create(kind: CatalogKind, body: object): Promise<Sensor | Variable> {
    const { data } = await appApi.post(`/sensor-catalog/${kind}`, body);
    return data;
  },
  async update(kind: CatalogKind, id: string, body: object): Promise<Sensor | Variable> {
    const { data } = await appApi.patch(`/sensor-catalog/${kind}/${id}`, body);
    return data;
  },
  async deactivate(kind: CatalogKind, id: string): Promise<void> {
    await appApi.delete(`/sensor-catalog/${kind}/${id}`);
  },
};
