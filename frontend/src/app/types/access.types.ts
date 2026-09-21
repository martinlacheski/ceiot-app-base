export const SCOPE_TYPE = {
  ENVIRONMENT: "environment",
  DEVICE: "device",
} as const;

export type ScopeType = (typeof SCOPE_TYPE)[keyof typeof SCOPE_TYPE];

export interface ScopedGuestRelation {
  id: string;
  ownerUserId: string;
  guestUserId: string;
  scopeType: ScopeType;
  scopeId: string;
  accessStartsAt: string;
  isActive: boolean;
}

export interface ScopedGuestInvitation {
  id: string;
  ownerUserId: string;
  email: string;
  scopeType: ScopeType;
  scopeId: string;
  accessStartsAt: string;
  status: string;
  isActive: boolean;
}

export interface EffectiveGuest {
  guestUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  accessStartsAt: string;
  sourceScope: ScopeType;
}

export interface DeviceAccessContext {
  deviceId: string;
  environmentId: string;
  ownerUserId: string;
  actorUserId: string;
  isOwner: boolean;
  isGuest: boolean;
  canReadMovements: boolean;
  canManageGuests: boolean;
  canOperateDevice: boolean;
  guests: EffectiveGuest[];
  pendingInvitations: ScopedGuestInvitation[];
}

export interface EnvironmentInvitation {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
  scopeType: ScopeType;
  environmentId: string;
  ownerId: string;
  accessStartsAt?: string;
  isActive: boolean;
}

export interface EnvironmentInvitationListResponse {
  items: EnvironmentInvitation[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}
