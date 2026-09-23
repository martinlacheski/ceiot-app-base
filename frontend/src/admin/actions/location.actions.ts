import { appApi } from "@/api/appApi";
import type {
  City,
  CityCreate,
  CityUpdate,
  Country,
  CountryCreate,
  CountryUpdate,
  State,
  StateCreate,
  StateUpdate,
} from "@/interfaces/location.interface";

// --- COUNTRY ---

// --- COUNTRY ---

export const getCountriesAction = async ({
  page = 1,
  size = 100,
  isActive,
  search,
  sort,
}: {
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) => {
  const response = await appApi.get("/location/countries", {
    params: { page, per_page: size, is_active: isActive, search, sort },
  });
  return response.data; // Expected: { items: [], total: ... }
};

export const getCountryAction = async (id: string): Promise<Country> => {
  const response = await appApi.get<Country>(`/location/countries/${id}`);
  return response.data;
};

export const createCountryAction = async (data: CountryCreate) => {
  const response = await appApi.post("/location/countries/", data);
  return response.data;
};

export const updateCountryAction = async ({
  id,
  data,
}: {
  id: string;
  data: CountryUpdate;
}) => {
  const response = await appApi.put(`/location/countries/${id}`, data);
  return response.data;
};

export const deleteCountryAction = async (id: string) => {
  await appApi.delete(`/location/countries/${id}`);
};

// --- STATE ---

export const getStatesAction = async ({
  countryId,
  page = 1,
  size = 100,
  isActive,
  search,
  sort,
}: {
  countryId?: string;
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) => {
  const response = await appApi.get("/location/states", {
    params: {
      country_id: countryId,
      page,
      per_page: size,
      is_active: isActive,
      search,
      sort,
    },
  });
  return response.data;
};

export const getStateAction = async (id: string): Promise<State> => {
  const response = await appApi.get<State>(`/location/states/${id}`);
  return response.data;
};

export const createStateAction = async (data: StateCreate) => {
  const response = await appApi.post("/location/states/", data);
  return response.data;
};

export const updateStateAction = async ({
  id,
  data,
}: {
  id: string;
  data: StateUpdate;
}) => {
  const response = await appApi.put(`/location/states/${id}`, data);
  return response.data;
};

export const deleteStateAction = async (id: string) => {
  await appApi.delete(`/location/states/${id}`);
};

// --- CITY ---

export const getCitiesAction = async ({
  countryId,
  stateId,
  page = 1,
  size = 100,
  isActive,
  search,
  sort,
}: {
  countryId?: string;
  stateId?: string;
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}) => {
  const response = await appApi.get("/location/cities", {
    params: {
      country_id: countryId,
      state_id: stateId,
      page,
      per_page: size,
      is_active: isActive,
      search,
      sort,
    },
  });
  return response.data;
};

export const getCityAction = async (id: string): Promise<City> => {
  const response = await appApi.get<City>(`/location/cities/${id}`);
  return response.data;
};

export const createCityAction = async (data: CityCreate) => {
  const response = await appApi.post("/location/cities/", data);
  return response.data;
};

export const updateCityAction = async ({
  id,
  data,
}: {
  id: string;
  data: CityUpdate;
}) => {
  const response = await appApi.put(`/location/cities/${id}`, data);
  return response.data;
};

export const deleteCityAction = async (id: string) => {
  await appApi.delete(`/location/cities/${id}`);
};

export const resolveLocationAction = async (inputValue: string) => {
  const response = await appApi.post("/location/resolve", {
    input_value: inputValue,
  });
  return response.data;
};
