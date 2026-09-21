export interface IdentificationType {
  id: string; // UUID
  name: string;
  is_active: boolean;
}

export interface IdentificationTypeCreate {
  name: string;
}

export interface IdentificationTypeUpdate {
  name?: string;
  is_active?: boolean;
}
