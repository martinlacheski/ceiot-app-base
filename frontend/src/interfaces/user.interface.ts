export interface User {
  id: string; // UUID
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  identificationNumber?: string;
  birthDate?: string;
  phone?: string;
  address?: string;

  // Foreign Keys (UUIDs)
  identificationTypeId?: string;
  cityId?: string;

  isActive: boolean;
  isAdmin: boolean;
  isSocialAuth?: boolean;
  permissions: string[];
}

export interface SessionUser extends User {
  fullName: string;
}
