export interface Country {
  id: string; // UUID
  name: string;
  is_active: boolean;
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
  country_id: string; // UUID
  is_active: boolean;
  country?: Country;
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
  postal_code: string;
  state_id: string; // UUID
  is_active: boolean;
  state?: State;
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
