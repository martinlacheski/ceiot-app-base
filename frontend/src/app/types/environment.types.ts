import type { PaginatedResponse } from "./common.types";

export const ENVIRONMENT_ROLE = {
  OWNER: "owner",
  GUEST: "guest",
} as const;

export type EnvironmentRole =
  (typeof ENVIRONMENT_ROLE)[keyof typeof ENVIRONMENT_ROLE];

export interface Environment {
  id: string;
  name: string;
  address: string;
  location: string;
  description: string;
  phone?: string;
  cityId: string;
  typeId: string;
  isActive: boolean;
  isPublicMapVisible?: boolean;

  // Computed/Related fields from backend
  type?: {
    id: string;
    name: string;
  };
  city?: {
    id: string;
    name: string;
    state?: {
      id: string;
      name: string;
      country?: {
        id: string;
        name: string;
      };
    };
  };
  ownerName?: string;
  ownerId?: string;
  currentUserRole?: EnvironmentRole | null;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface EnvironmentCreate {
  name: string;
  address: string;
  location: string;
  description: string;
  phone?: string;
  cityId: string;
  typeId: string;
  isActive?: boolean;
  isPublicMapVisible?: boolean;
}

export interface EnvironmentUpdate {
  name?: string;
  address?: string;
  location?: string;
  description?: string;
  phone?: string;
  cityId?: string;
  typeId?: string;
  isActive?: boolean;
  isPublicMapVisible?: boolean;
}

export type EnvironmentsResponse = PaginatedResponse<Environment>;

export const ENVIRONMENT_SORT_BY = {
  NAME: "name",
  TYPE: "type",
  OWNER: "owner",
  STATUS: "status",
} as const;

export type EnvironmentSortBy =
  (typeof ENVIRONMENT_SORT_BY)[keyof typeof ENVIRONMENT_SORT_BY];
export type SortOrder = "asc" | "desc";

export interface EnvironmentFilters {
  page: number;
  perPage: number;
  search?: string;
  isActive?: boolean;
  countryId?: string;
  stateId?: string;
  cityId?: string;
  typeId?: string;
  userId?: string; // For admin filtering by user if needed, or internal use
  ownerId?: string; // Strict owner filter (admin cascade: user -> environment -> device)
  sortBy: EnvironmentSortBy;
  sortOrder: SortOrder;
}

// Environment Types
export interface EnvironmentType {
  id: string;
  name: string;
  is_active: boolean;
}

export type EnvironmentTypesResponse = PaginatedResponse<EnvironmentType>;
