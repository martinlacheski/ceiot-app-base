export interface EnvironmentType {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EnvironmentTypeListItem {
  id: string;
  name: string;
  is_active: boolean;
}

export interface EnvironmentTypeCreate {
  name: string;
  is_active?: boolean;
}

export interface EnvironmentTypeUpdate {
  name?: string;
  is_active?: boolean;
}
