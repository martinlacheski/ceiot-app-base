import type { PaginatedResponse } from "./common.types";

export interface DeviceTypeCatalog {
  id: string;
  name: string;
  isActive: boolean;
}

export const DEVICE_EFFECTIVE_LOCATION_SOURCE = {
  DEVICE_GPS: "device_gps",
  ENVIRONMENT: "environment",
} as const;

export type DeviceEffectiveLocationSource =
  (typeof DEVICE_EFFECTIVE_LOCATION_SOURCE)[keyof typeof DEVICE_EFFECTIVE_LOCATION_SOURCE];

export interface DeviceEnvironmentCitySummary {
  name: string;
}

export interface DeviceEnvironmentSummary {
  id: string;
  name: string;
  address?: string;
  location?: string;
  ownerName?: string;
  ownerId?: string;
  city?: DeviceEnvironmentCitySummary;
}

export interface Device {
  id: string;
  serial: string;
  name: string;
  description?: string;
  deviceTypeId: string;
  model?: string;
  batch?: string;
  manufactureDate?: string; // ISO date string
  macAddress?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsUpdatedAt?: string | null;
  effectiveLocation?: string | null;
  effectiveLocationSource?: DeviceEffectiveLocationSource | null;
  status: "new" | "paired" | "active" | "maintenance" | "unpaired";
  isActive: boolean;
  enabled: boolean;
  environmentId?: string;
  updatedAt?: string;
  lastConnection?: string; // ISO date string
  brokerConnected: boolean | null;
  brokerConnectedAt?: string | null;
  brokerDisconnectedAt?: string | null;
  brokerStatusUpdatedAt?: string | null;
  type?: DeviceTypeCatalog;

  // Relations
  environment?: DeviceEnvironmentSummary;
}

export interface DeviceCreate {
  serial: string;
  name: string;
  description?: string;
  deviceTypeId?: string;
  model?: string;
  batch?: string;
  manufactureDate?: string;
}

export interface DeviceUpdate {
  name?: string;
  description?: string;
  deviceTypeId?: string;
  enabled?: boolean;
  isActive?: boolean;
}

export interface DevicePairingRequest {
  serial: string;
  environmentId: string;
  description: string;
}

export type DevicesResponse = PaginatedResponse<Device>;
export type DeviceTypesResponse = PaginatedResponse<DeviceTypeCatalog>;

export const DEVICE_SORT_BY = {
  NAME: "name",
  SERIAL: "serial",
  MODEL: "model",
  MANUFACTURE_DATE: "manufactureDate",
  STATUS: "status",
  ENABLED: "enabled",
  IS_ACTIVE: "isActive",
  LAST_CONNECTION: "lastConnection",
  BROKER_CONNECTED: "brokerConnected",
} as const;

export type DeviceSortBy =
  (typeof DEVICE_SORT_BY)[keyof typeof DEVICE_SORT_BY];
export type DeviceSortOrder = "asc" | "desc";

export interface DeviceFilters {
  page: number;
  perPage: number;
  search?: string;
  isActive?: boolean;
  environmentId?: string;
  ownerId?: string;
  // New filters
  deviceTypeId?: string;
  model?: string;
  batch?: string;
  manufactureDate?: string;
  status?: string;
  enabled?: boolean | string; // string 'true'/'false' for URL params
  sortBy: DeviceSortBy;
  sortOrder: DeviceSortOrder;
}

export interface DeviceOperation {
  time: string;
  id: string;
  device_serial?: string;
  operation_type: string;
  status: string;
}
