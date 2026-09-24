import { appApi } from "@/api/appApi";
import {
  type Device,
  type DeviceCreate,
  type DeviceUpdate,
  type DevicesResponse,
  type DeviceTypesResponse,
  type DeviceFilters,
  type DeviceMoveRequest,
  type DevicePairingRequest,
  type DeviceOperation,
} from "../types/device.types";
import type {
  DeviceAccessContext,
  EffectiveGuest,
  ScopedGuestInvitation,
  ScopedGuestRelation,
} from "../types/access.types";
import {
  formatDeviceLocation,
  getDeviceLocationSourceLabel,
} from "../components/devices/deviceMap";
import { formatDateTime } from "@/utils/date.utils";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { downloadReport, toFilenamePart } from "@/lib/downloadReport";
import { getDeviceStatusLabel, getOperationStatusLabel, getOperationTypeLabel } from "@/utils/status-labels";

const BASE_URL = "/devices";

interface DeviceOperationApi {
  time?: string;
  id?: string;
  device_id?: string;
  deviceId?: string;
  device_serial?: string;
  deviceSerial?: string;
  operation_type?: string;
  operationType?: string;
  status?: string;
  payload?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

interface DeviceOperationsResponseApi {
  items?: DeviceOperationApi[];
  total: number;
  page: number;
  per_page?: number;
  perPage?: number;
  pages: number;
}

export type DeviceOperationSortBy =
  | "time"
  | "id"
  | "operation_type"
  | "status";

export interface DeviceOperationFilters {
  page: number;
  perPage: number;
  startDate?: Date;
  endDate?: Date;
  operationType?: string;
  search?: string;
  sortBy?: DeviceOperationSortBy;
  sortOrder?: "asc" | "desc";
}

interface ScopedGuestRelationApi {
  id: string;
  owner_user_id?: string;
  ownerUserId?: string;
  guest_user_id?: string;
  guestUserId?: string;
  scope_type?: ScopedGuestRelation["scopeType"];
  scopeType?: ScopedGuestRelation["scopeType"];
  scope_id?: string;
  scopeId?: string;
  access_starts_at?: string;
  accessStartsAt?: string;
  is_active?: boolean;
  isActive?: boolean;
}

interface ScopedGuestInvitationApi {
  id: string;
  owner_user_id?: string;
  ownerUserId?: string;
  email?: string;
  scope_type?: ScopedGuestInvitation["scopeType"];
  scopeType?: ScopedGuestInvitation["scopeType"];
  scope_id?: string;
  scopeId?: string;
  access_starts_at?: string;
  accessStartsAt?: string;
  status?: string;
  is_active?: boolean;
  isActive?: boolean;
}

interface EffectiveGuestApi {
  guest_user_id?: string;
  guestUserId?: string;
  email?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
  phone?: string | null;
  access_starts_at?: string;
  accessStartsAt?: string;
  source_scope?: EffectiveGuest["sourceScope"];
  sourceScope?: EffectiveGuest["sourceScope"];
}

interface DeviceAccessContextApi {
  device_id?: string;
  deviceId?: string;
  environment_id?: string;
  environmentId?: string;
  owner_user_id?: string;
  ownerUserId?: string;
  actor_user_id?: string;
  actorUserId?: string;
  is_owner?: boolean;
  isOwner?: boolean;
  is_guest?: boolean;
  isGuest?: boolean;
  can_read_movements?: boolean;
  canReadMovements?: boolean;
  can_manage_guests?: boolean;
  canManageGuests?: boolean;
  can_operate_device?: boolean;
  canOperateDevice?: boolean;
  guests?: EffectiveGuestApi[];
  pending_invitations?: ScopedGuestInvitationApi[];
  pendingInvitations?: ScopedGuestInvitationApi[];
}

export const mapDeviceOperation = (
  op: DeviceOperationApi,
): DeviceOperation => ({
  time: op.time ?? "",
  id: op.id ?? "",
  device_serial: op.device_serial ?? op.deviceSerial,
  operation_type: op.operation_type ?? op.operationType ?? "OTHER",
  status: op.status ?? "pending",
});

const mapScopedGuestRelation = (
  relation: ScopedGuestRelationApi,
): ScopedGuestRelation => ({
  id: relation.id,
  ownerUserId: relation.owner_user_id ?? relation.ownerUserId ?? "",
  guestUserId: relation.guest_user_id ?? relation.guestUserId ?? "",
  scopeType: relation.scope_type ?? relation.scopeType ?? "device",
  scopeId: relation.scope_id ?? relation.scopeId ?? "",
  accessStartsAt: relation.access_starts_at ?? relation.accessStartsAt ?? "",
  isActive: Boolean(relation.is_active ?? relation.isActive),
});

const mapScopedGuestInvitation = (
  invitation: ScopedGuestInvitationApi,
): ScopedGuestInvitation => ({
  id: invitation.id,
  ownerUserId: invitation.owner_user_id ?? invitation.ownerUserId ?? "",
  email: invitation.email ?? "",
  scopeType: invitation.scope_type ?? invitation.scopeType ?? "device",
  scopeId: invitation.scope_id ?? invitation.scopeId ?? "",
  accessStartsAt:
    invitation.access_starts_at ?? invitation.accessStartsAt ?? "",
  status: invitation.status ?? "pending",
  isActive: Boolean(invitation.is_active ?? invitation.isActive),
});

export const mapDeviceAccessContext = (
  context: DeviceAccessContextApi,
): DeviceAccessContext => ({
  deviceId: context.device_id ?? context.deviceId ?? "",
  environmentId: context.environment_id ?? context.environmentId ?? "",
  ownerUserId: context.owner_user_id ?? context.ownerUserId ?? "",
  actorUserId: context.actor_user_id ?? context.actorUserId ?? "",
  isOwner: Boolean(context.is_owner ?? context.isOwner),
  isGuest: Boolean(context.is_guest ?? context.isGuest),
  canReadMovements: Boolean(
    context.can_read_movements ?? context.canReadMovements,
  ),
  canManageGuests: Boolean(
    context.can_manage_guests ?? context.canManageGuests,
  ),
  canOperateDevice: Boolean(
    context.can_operate_device ?? context.canOperateDevice,
  ),
  guests: (context.guests ?? []).map((guest) => ({
    guestUserId: guest.guest_user_id ?? guest.guestUserId ?? "",
    email: guest.email ?? null,
    firstName: guest.first_name ?? guest.firstName ?? null,
    lastName: guest.last_name ?? guest.lastName ?? null,
    phone: guest.phone ?? null,
    accessStartsAt: guest.access_starts_at ?? guest.accessStartsAt ?? "",
    sourceScope: guest.source_scope ?? guest.sourceScope ?? "device",
  })),
  pendingInvitations: (
    context.pending_invitations ??
    context.pendingInvitations ??
    []
  ).map(mapScopedGuestInvitation),
});

const mapDeviceOperationsResponse = (
  data: DeviceOperationsResponseApi,
): {
  items: DeviceOperation[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
} => ({
  items: (data.items ?? []).map(mapDeviceOperation),
  total: data.total,
  page: data.page,
  per_page: data.per_page ?? data.perPage ?? 0,
  pages: data.pages,
});

export const deviceService = {
  getManufactureDates: async (): Promise<string[]> => {
    const { data } = await appApi.get<string[]>(
      `${BASE_URL}/manufacture-dates`,
    );
    return data;
  },

  getAll: async (filters: DeviceFilters): Promise<DevicesResponse> => {
    const params = new URLSearchParams();
    params.append("page", filters.page.toString());
    params.append("per_page", filters.perPage.toString());

    const search = filters.search?.trim().slice(0, 64);
    if (search) params.append("search", search);
    if (filters.isActive !== undefined)
      params.append("is_active", filters.isActive.toString());
    if (filters.environmentId)
      params.append("environment_id", filters.environmentId);
    if (filters.ownerId) params.append("owner_id", filters.ownerId);

    if (filters.deviceTypeId && filters.deviceTypeId !== "all")
      params.append("device_type_id", filters.deviceTypeId);
    if (filters.model) params.append("model", filters.model);
    if (filters.batch) params.append("batch", filters.batch);
    if (filters.manufactureDate)
      params.append("manufacture_date", filters.manufactureDate);
    if (search || filters.manufactureDate) {
      params.append(
        "utc_offset_minutes",
        String(-new Date().getTimezoneOffset()),
      );
    }
    if (filters.status && filters.status !== "all")
      params.append("status", filters.status);
    if (filters.enabled !== undefined && filters.enabled !== "all") {
      params.append("enabled", String(filters.enabled));
    }
    params.append("sort_by", filters.sortBy);
    params.append("sort_order", filters.sortOrder);

    const { data } = await appApi.get<DevicesResponse>(`${BASE_URL}`, {
      params,
    });
    return data;
  },

  getById: async (id: string): Promise<Device> => {
    const { data } = await appApi.get<Device>(`${BASE_URL}/${id}`);
    return data;
  },

  create: async (device: DeviceCreate): Promise<Device> => {
    const { data } = await appApi.post<Device>(`${BASE_URL}`, device);
    return data;
  },

  getTypes: async (): Promise<DeviceTypesResponse> => {
    const params = new URLSearchParams();
    params.append("page", "1");
    params.append("per_page", "100");
    params.append("is_active", "true");

    const { data } = await appApi.get<DeviceTypesResponse>(
      `${BASE_URL}/types`,
      {
        params,
      },
    );
    return data;
  },

  update: async (id: string, device: DeviceUpdate): Promise<Device> => {
    const { data } = await appApi.put<Device>(`${BASE_URL}/${id}`, device);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await appApi.delete(`${BASE_URL}/${id}`);
  },

  pair: async (request: DevicePairingRequest): Promise<Device> => {
    const { data } = await appApi.post<Device>(`${BASE_URL}/pair`, request);
    return data;
  },

  checkSerial: async (
    serial: string,
  ): Promise<{
    status: "available" | "paired" | "not_found";
    message: string;
    environment_id?: string;
  }> => {
    const { data } = await appApi.get<{
      status: "available" | "paired" | "not_found";
      message: string;
      environment_id?: string;
    }>(`${BASE_URL}/check-serial?serial=${serial}`);
    return data;
  },

  unpair: async (id: string): Promise<Device> => {
    const { data } = await appApi.post<Device>(`${BASE_URL}/${id}/unpair`);
    return data;
  },

  move: async (id: string, request: DeviceMoveRequest): Promise<Device> => {
    const { data } = await appApi.post<Device>(`${BASE_URL}/${id}/move`, request);
    return data;
  },

  export: async (
    format: "excel" | "pdf",
    filters: DeviceFilters,
    options?: { generatedBy?: string },
  ): Promise<void> => {
    const params = { ...filters, perPage: 10000, page: 1 };
    const items = await fetchAllPages((page, perPage) =>
      deviceService.getAll({ ...params, page, perPage }),
    );

    const columns = [
      "Serial",
      "Dispositivo",
      "Tipo",
      "Modelo",
      "Ubicación",
      "Situación",
      "Habilitado",
      "Estado",
      "Establecimiento",
    ];

    const data = items.map((dev) => [
      dev.serial,
      dev.name,
      dev.type?.name || "-",
      dev.model || "-",
      (() => {
        const location = formatDeviceLocation(dev);
        const sourceLabel = getDeviceLocationSourceLabel(dev);
        if (location === "-") return location;
        return sourceLabel ? `${location} (${sourceLabel})` : location;
      })(),
      getDeviceStatusLabel(dev.status),
      dev.enabled ? "Sí" : "No",
      dev.isActive ? "Activo" : "Inactivo",
      dev.environment?.name || "-",
    ]);

    const generatedBy = options?.generatedBy || "Usuario";

    await downloadReport(format, {
      title: "Reporte de Dispositivos",
      filename: "dispositivos",
      generatedBy,
      columns,
      data,
    });
  },

  getOperations: async (
    deviceId: string,
    filters: DeviceOperationFilters,
  ): Promise<{
    items: DeviceOperation[];
    total: number;
    page: number;
    per_page: number;
    pages: number;
  }> => {
    const params = new URLSearchParams();
    params.append("page", filters.page.toString());
    params.append("per_page", filters.perPage.toString());

    if (filters.startDate)
      params.append("start_date", filters.startDate.toISOString());
    if (filters.endDate)
      params.append("end_date", filters.endDate.toISOString());
    if (filters.operationType && filters.operationType !== "all")
      params.append("operation_type", filters.operationType);
    const search = filters.search?.trim().slice(0, 64);
    if (search) params.append("search", search);
    if (filters.sortBy) params.append("sort_by", filters.sortBy);
    if (filters.sortOrder) params.append("sort_order", filters.sortOrder);
    if (search || filters.startDate || filters.endDate) {
      params.append(
        "utc_offset_minutes",
        String(-new Date().getTimezoneOffset()),
      );
    }

    const { data } = await appApi.get<DeviceOperationsResponseApi>(
      `${BASE_URL}/operations/by-device/${deviceId}`,
      {
        params,
      },
    );
    return mapDeviceOperationsResponse(data);
  },

  exportOperations: async (
    deviceId: string,
    deviceName: string,
    format: "excel" | "pdf",
    filters: DeviceOperationFilters,
    options?: { generatedBy?: string },
  ): Promise<void> => {
    const items = await fetchAllPages((page, perPage) =>
      deviceService.getOperations(deviceId, { ...filters, page, perPage }),
    );
    await downloadReport(format, {
      title: `Operaciones - ${deviceName}`,
      filename: `operaciones_${toFilenamePart(deviceName)}`,
      generatedBy: options?.generatedBy || "Usuario",
      columns: ["Fecha/Hora", "ID", "Tipo", "Estado"],
      data: items.map((operation) => [
        formatDateTime(operation.time),
        operation.id,
        getOperationTypeLabel(operation.operation_type),
        getOperationStatusLabel(operation.status),
      ]),
    });
  },

  getAccessContext: async (deviceId: string): Promise<DeviceAccessContext> => {
    const { data } = await appApi.get<DeviceAccessContextApi>(
      `/access/devices/${deviceId}/context`,
    );
    return mapDeviceAccessContext(data);
  },

  createGuestRelation: async (
    deviceId: string,
    payload: {
      guestUserId: string;
      accessStartsAt?: string;
    },
  ): Promise<ScopedGuestRelation> => {
    const { data } = await appApi.post<ScopedGuestRelationApi>(
      `${BASE_URL}/${deviceId}/guests`,
      {
        guest_user_id: payload.guestUserId,
        access_starts_at: payload.accessStartsAt,
      },
    );
    return mapScopedGuestRelation(data);
  },

  inviteGuestByEmail: async (
    deviceId: string,
    payload: { email: string; accessStartsAt?: string },
  ): Promise<ScopedGuestInvitation> => {
    const { data } = await appApi.post<ScopedGuestInvitationApi>(
      `${BASE_URL}/${deviceId}/guest-invitations`,
      {
        email: payload.email,
        access_starts_at: payload.accessStartsAt,
      },
    );
    return mapScopedGuestInvitation(data);
  },

  revokeGuestInvitation: async (
    deviceId: string,
    invitationId: string,
  ): Promise<ScopedGuestInvitation> => {
    const { data } = await appApi.delete<ScopedGuestInvitationApi>(
      `${BASE_URL}/${deviceId}/guest-invitations/${invitationId}`,
    );
    return mapScopedGuestInvitation(data);
  },

  updateGuestInvitation: async (
    deviceId: string,
    invitationId: string,
    payload: { accessStartsAt?: string },
  ): Promise<ScopedGuestInvitation> => {
    const { data } = await appApi.patch<ScopedGuestInvitationApi>(
      `${BASE_URL}/${deviceId}/guest-invitations/${invitationId}`,
      { access_starts_at: payload.accessStartsAt },
    );
    return mapScopedGuestInvitation(data);
  },

  updateGuestRelation: async (
    deviceId: string,
    guestUserId: string,
    payload: { accessStartsAt?: string },
  ): Promise<ScopedGuestRelation> => {
    const { data } = await appApi.patch<ScopedGuestRelationApi>(
      `${BASE_URL}/${deviceId}/guests/${guestUserId}`,
      { access_starts_at: payload.accessStartsAt },
    );
    return mapScopedGuestRelation(data);
  },

  deactivateGuestRelation: async (
    deviceId: string,
    guestUserId: string,
  ): Promise<ScopedGuestRelation> => {
    const { data } = await appApi.delete<ScopedGuestRelationApi>(
      `${BASE_URL}/${deviceId}/guests/${guestUserId}`,
    );
    return mapScopedGuestRelation(data);
  },
};
