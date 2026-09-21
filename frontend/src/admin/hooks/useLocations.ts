import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCityAction,
  createCountryAction,
  createStateAction,
  deleteCityAction,
  deleteCountryAction,
  deleteStateAction,
  getCitiesAction,
  getCityAction,
  getCountriesAction,
  getCountryAction,
  getStatesAction,
  getStateAction,
  updateCityAction,
  updateCountryAction,
  updateStateAction,
} from "../actions/location.actions";

// Types corresponding to the new backend params
// Types corresponding to the new backend params
export interface GetLocationsParams {
  page?: number;
  size?: number;
  isActive?: boolean;
  search?: string;
  sort?: string;
}

export interface GetStatesParams extends GetLocationsParams {
  countryId?: string;
}

export interface GetCitiesParams extends GetLocationsParams {
  countryId?: string;
  stateId?: string;
}

// --- COUNTRIES ---

export const useCountries = (params: GetLocationsParams) => {
  return useQuery({
    queryKey: ["countries", params],
    queryFn: () => getCountriesAction(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useCountry = (id: string) => {
  return useQuery({
    queryKey: ["countries", id],
    queryFn: () => getCountryAction(id),
    enabled: !!id,
  });
};

export const useCreateCountry = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCountryAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["countries"] });
    },
  });
};

export const useUpdateCountry = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      updateCountryAction({ id, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["countries"] });
    },
  });
};

export const useDeleteCountry = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCountryAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["countries"] });
    },
  });
};

// --- STATES ---

export const useStates = (params: GetStatesParams) => {
  return useQuery({
    queryKey: ["states", params],
    queryFn: () => getStatesAction(params),
    staleTime: 1000 * 60 * 5,
  });
};

export const useLocationState = (id: string) => {
  return useQuery({
    queryKey: ["states", id],
    queryFn: () => getStateAction(id),
    enabled: !!id,
  });
};

export const useCreateState = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStateAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["states"] });
    },
  });
};

export const useUpdateState = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      updateStateAction({ id, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["states"] });
    },
  });
};

export const useDeleteState = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStateAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["states"] });
    },
  });
};

// --- CITIES ---

export const useCities = (params: GetCitiesParams) => {
  return useQuery({
    queryKey: ["cities", params],
    queryFn: () => getCitiesAction(params),
    staleTime: 1000 * 60 * 5,
  });
};

export const useLocationCity = (id: string) => {
  return useQuery({
    queryKey: ["cities", id],
    queryFn: () => getCityAction(id),
    enabled: !!id,
  });
};

export const useCreateCity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCityAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
  });
};

export const useUpdateCity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      updateCityAction({ id, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
  });
};

export const useDeleteCity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCityAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
  });
};
