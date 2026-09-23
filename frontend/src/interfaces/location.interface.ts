export interface Country {
  id: string; // UUID
  name: string;
  isActive: boolean;
}

export interface CountryCreate {
  name: string;
  is_active?: boolean;
}

export interface CountryUpdate {
  name?: string;
  is_active?: boolean;
}

export interface State {
  id: string; // UUID
  name: string;
  isActive: boolean;
  country?: Country | null;
}

export interface StateCreate {
  name: string;
  country_id: string;
  is_active?: boolean;
}

export interface StateUpdate {
  name?: string;
  country_id?: string;
  is_active?: boolean;
}

export interface City {
  id: string; // UUID
  name: string;
  postalCode: string | null;
  isActive: boolean;
  state?: State | null;
}

export interface CityCreate {
  name: string;
  postal_code: string;
  state_id: string;
  is_active?: boolean;
}

export interface CityUpdate {
  name?: string;
  postal_code?: string;
  state_id?: string;
  is_active?: boolean;
}
