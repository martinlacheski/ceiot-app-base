import { appApi } from "@/api/appApi";
import {
  type Environment,
  type EnvironmentCreate,
  type EnvironmentUpdate,
  type EnvironmentsResponse,
  type EnvironmentFilters,
  type EnvironmentTypesResponse,
} from "../types/environment.types";
import type {
  EnvironmentInvitation,
  EnvironmentInvitationListResponse,
} from "../types/access.types";

const ACCESS_BASE_URL = "/access/scopes/environment";

const BASE_URL = "/environment";

const readValue = <T>(
  source: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  fallback?: T,
): T | undefined =>
  (source[camelKey] ?? source[snakeKey] ?? fallback) as T | undefined;

const normalizeEnvironment = (
  source: Record<string, unknown>,
): Environment => ({
  id: String(source.id ?? ""),
  name: String(source.name ?? ""),
  address: String(source.address ?? ""),
  location: String(source.location ?? ""),
  description: String(source.description ?? ""),
  phone: readValue<string>(source, "phone", "phone"),
  cityId: String(readValue(source, "cityId", "city_id", "")),
  typeId: String(readValue(source, "typeId", "type_id", "")),
  isActive: Boolean(readValue(source, "isActive", "is_active", true)),
  isPublicMapVisible: Boolean(
    readValue(source, "isPublicMapVisible", "is_public_map_visible", false),
  ),
  type: source.type as Environment["type"],
  city: source.city as Environment["city"],
  ownerName: readValue<string>(source, "ownerName", "owner_name"),
  ownerId: readValue<string>(source, "ownerId", "owner_id"),
  currentUserRole:
    readValue<Environment["currentUserRole"]>(
      source,
      "currentUserRole",
      "current_user_role",
      null,
    ) ?? null,
  canEdit: Boolean(readValue(source, "canEdit", "can_edit", false)),
  canDelete: Boolean(readValue(source, "canDelete", "can_delete", false)),
});

const normalizeEnvironmentList = (
  source: Record<string, unknown>,
): EnvironmentsResponse => ({
  items: Array.isArray(source.items)
    ? source.items.map((item) =>
        normalizeEnvironment(item as Record<string, unknown>),
      )
    : [],
  total: Number(source.total ?? 0),
  page: Number(source.page ?? 1),
  size: Number(source.size ?? source.per_page ?? source.perPage ?? 0),
  pages: Number(source.pages ?? 1),
});

const serializeEnvironment = (
  environment: EnvironmentCreate | EnvironmentUpdate,
): Record<string, unknown> =>
  Object.fromEntries(
    [
      "name",
      "address",
      "location",
      "description",
      "phone",
      "cityId",
      "typeId",
      "isActive",
      "isPublicMapVisible",
    ]
      .filter((key) => key in environment)
      .map((key) => [key, environment[key as keyof typeof environment]]),
  );

const normalizeInvitation = (
  invitation: Record<string, unknown>,
): EnvironmentInvitation => ({
  id: String(invitation.id ?? ""),
  email: String(invitation.email ?? ""),
  firstName: (invitation.first_name ?? invitation.firstName ?? null) as
    string | null,
  lastName: (invitation.last_name ?? invitation.lastName ?? null) as
    string | null,
  status: String(invitation.status ?? ""),
  scopeType: (invitation.scope_type ??
    invitation.scopeType ??
    "environment") as EnvironmentInvitation["scopeType"],
  environmentId: String(
    invitation.environment_id ??
      invitation.environmentId ??
      invitation.scope_id ??
      invitation.scopeId ??
      "",
  ),
  ownerId: String(
    invitation.owner_id ??
      invitation.ownerId ??
      invitation.owner_user_id ??
      invitation.ownerUserId ??
      "",
  ),
  accessStartsAt: String(
    invitation.access_starts_at ?? invitation.accessStartsAt ?? "",
  ),
  isActive: Boolean(invitation.is_active ?? invitation.isActive),
});

const normalizeInvitationList = (
  data: Record<string, unknown>,
): EnvironmentInvitationListResponse => ({
  items: Array.isArray(data.items)
    ? data.items.map((item) =>
        normalizeInvitation(item as Record<string, unknown>),
      )
    : [],
  total: Number(data.total ?? 0),
  page: Number(data.page ?? 1),
  perPage: Number(data.per_page ?? data.perPage ?? 10),
  pages: Number(data.pages ?? 1),
});

export const environmentService = {
  getAll: async (
    filters: EnvironmentFilters,
  ): Promise<EnvironmentsResponse> => {
    const params = new URLSearchParams();
    params.append("page", filters.page.toString());
    params.append("per_page", filters.perPage.toString());

    if (filters.search) params.append("search", filters.search);
    if (filters.isActive !== undefined)
      params.append("is_active", filters.isActive.toString());
    if (filters.countryId) params.append("country_id", filters.countryId);
    if (filters.stateId) params.append("state_id", filters.stateId);
    if (filters.cityId) params.append("city_id", filters.cityId);
    if (filters.typeId) params.append("type_id", filters.typeId);
    if (filters.userId) params.append("user_id", filters.userId);
    if (filters.ownerId) params.append("owner_id", filters.ownerId);
    params.append("sort_by", filters.sortBy);
    params.append("sort_order", filters.sortOrder);

    const { data } = await appApi.get<Record<string, unknown>>(`${BASE_URL}/`, {
      params,
    });
    return normalizeEnvironmentList(data);
  },

  getById: async (id: string): Promise<Environment> => {
    const { data } = await appApi.get<Record<string, unknown>>(
      `${BASE_URL}/${id}`,
    );
    return normalizeEnvironment(data);
  },

  create: async (environment: EnvironmentCreate): Promise<Environment> => {
    const { data } = await appApi.post<Record<string, unknown>>(
      `${BASE_URL}/`,
      serializeEnvironment(environment),
    );
    return normalizeEnvironment(data);
  },

  update: async (
    id: string,
    environment: EnvironmentUpdate,
  ): Promise<Environment> => {
    const { data } = await appApi.put<Record<string, unknown>>(
      `${BASE_URL}/${id}`,
      serializeEnvironment(environment),
    );
    return normalizeEnvironment(data);
  },

  delete: async (id: string): Promise<void> => {
    await appApi.delete(`${BASE_URL}/${id}`);
  },

  export: async (
    format: "excel" | "pdf",
    filters: EnvironmentFilters,
    options?: { generatedBy?: string },
  ): Promise<void> => {
    // 1. Fetch all data (or a large limit)
    const params = { ...filters, perPage: 10000, page: 1 };
    const response = await environmentService.getAll(params);
    const items = response.items;

    // 2. Define Columns
    const columns = [
      "Nombre",
      "Tipo",
      "Dueño",
      "País",
      "Provincia",
      "Ciudad",
      "Dirección",
      "Estado",
    ];

    // 3. Transform Data
    const data = items.map((env) => [
      env.name,
      env.type?.name || "-",
      env.ownerName || "-",
      env.city?.state?.country?.name || "-",
      env.city?.state?.name || "-",
      env.city?.name || "-",
      env.address || "-",
      env.isActive ? "Activo" : "Inactivo",
    ]);

    const generatedBy = options?.generatedBy || "Usuario";

    // 4. Call Utility
    if (format === "excel") {
      const { exportToExcel } = await import("@/lib/export.utils");
      await exportToExcel({
        title: "Reporte de Establecimientos",
        filename: "establecimientos",
        generatedBy,
        columns,
        data,
      });
    } else {
      const { exportToPdf } = await import("@/lib/export.utils");
      await exportToPdf({
        title: "Reporte de Establecimientos",
        filename: "establecimientos",
        generatedBy,
        columns,
        data,
      });
    }
  },

  getTypes: async (): Promise<EnvironmentTypesResponse> => {
    const params = new URLSearchParams();
    params.append("page", "1");
    params.append("per_page", "100");
    params.append("is_active", "true");

    const { data } = await appApi.get<EnvironmentTypesResponse>(
      `${BASE_URL}/types/`,
      { params },
    );
    return data;
  },

  checkAvailability: async (params: {
    name?: string;
    address?: string;
    cityId?: string;
  }): Promise<{ available: boolean; code?: string; message?: string }> => {
    const queryParams = new URLSearchParams();
    if (params.name) queryParams.append("name", params.name);
    if (params.address) queryParams.append("address", params.address);
    if (params.cityId) queryParams.append("city_id", params.cityId);

    const { data } = await appApi.get<{
      available: boolean;
      code?: string;
      message?: string;
    }>(`${BASE_URL}/check`, {
      params: queryParams,
    });
    return data;
  },

  sendInvitation: async (
    environmentId: string,
    payload: { email: string; accessStartsAt?: string },
  ): Promise<EnvironmentInvitation> => {
    const { data } = await appApi.post<Record<string, unknown>>(
      `${ACCESS_BASE_URL}/${environmentId}/guest-invitations`,
      {
        email: payload.email,
        access_starts_at: payload.accessStartsAt,
      },
    );

    return normalizeInvitation(data);
  },

  updateInvitation: async (
    environmentId: string,
    invitationId: string,
    payload: { accessStartsAt?: string },
  ): Promise<EnvironmentInvitation> => {
    const { data } = await appApi.patch<Record<string, unknown>>(
      `${ACCESS_BASE_URL}/${environmentId}/guest-invitations/${invitationId}`,
      { access_starts_at: payload.accessStartsAt },
    );

    return normalizeInvitation(data);
  },

  listInvitations: async (
    environmentId: string,
    params: { page?: number; perPage?: number } = {},
  ): Promise<EnvironmentInvitationListResponse> => {
    const { data } = await appApi.get(
      `${ACCESS_BASE_URL}/${environmentId}/guest-invitations`,
    );

    return normalizeInvitationList({
      items: Array.isArray(data) ? data : [],
      total: Array.isArray(data) ? data.length : 0,
      page: params.page ?? 1,
      per_page: params.perPage ?? 20,
      pages: 1,
    });
  },

  revokeInvitation: async (
    environmentId: string,
    invitationId: string,
  ): Promise<void> => {
    await appApi.delete(
      `${ACCESS_BASE_URL}/${environmentId}/guest-invitations/${invitationId}`,
    );
  },
};
