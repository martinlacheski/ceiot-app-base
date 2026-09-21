export interface EnvironmentType {
  id: string;
  name: string;
  is_active: boolean;
}

export interface EnvironmentTypeCreate {
  name: string;
}

export interface EnvironmentTypeUpdate {
  name?: string;
  is_active?: boolean;
}
