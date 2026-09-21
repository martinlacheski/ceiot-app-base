/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { deviceService } from "../services/device.service";
import {
  type DeviceCreate,
  type DeviceUpdate,
  type DeviceFilters,
  type DevicePairingRequest,
} from "../types/device.types";
import { toast } from "sonner";
import { useNavigate } from "react-router";

const getHttpStatus = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status ===
      "number"
  ) {
    return (error as { response?: { status?: number } }).response?.status;
  }

  return undefined;
};

// Keys
export const deviceKeys = {
  all: ["devices"] as const,
  lists: () => [...deviceKeys.all, "list"] as const,
  list: (filters: DeviceFilters) =>
    [...deviceKeys.lists(), { ...filters }] as const,
  details: () => [...deviceKeys.all, "detail"] as const,
  detail: (id: string) => [...deviceKeys.details(), id] as const,
  types: () => [...deviceKeys.all, "types"] as const,
};

// Queries
export function useDevices(
  filters: DeviceFilters,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: deviceKeys.list(filters),
    queryFn: () => deviceService.getAll(filters),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useDevice(id: string) {
  return useQuery({
    queryKey: deviceKeys.detail(id),
    queryFn: () => deviceService.getById(id),
    enabled: !!id,
    retry: (_failureCount, error) => getHttpStatus(error) !== 404,
  });
}

export function useDeviceManufactureDates() {
  return useQuery({
    queryKey: [...deviceKeys.all, "manufacture-dates"],
    queryFn: () => deviceService.getManufactureDates(),
  });
}

export function useDeviceTypes() {
  return useQuery({
    queryKey: deviceKeys.types(),
    queryFn: () => deviceService.getTypes(),
    staleTime: 1000 * 60 * 60,
  });
}

// Mutations
export function useCreateDevice() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (data: DeviceCreate) => deviceService.create(data),
    onSuccess: () => {
      toast.success("Dispositivo creado exitosamente");
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
      navigate("/admin/devices");
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail || "Error al crear el dispositivo",
      );
    },
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeviceUpdate }) =>
      deviceService.update(id, data),
    onSuccess: (data) => {
      toast.success("Dispositivo actualizado exitosamente");
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deviceKeys.detail(data.id) });
      navigate(-1);
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail || "Error al actualizar el dispositivo",
      );
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deviceService.delete(id),
    onSuccess: () => {
      toast.success("Dispositivo eliminado exitosamente");
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail || "Error al eliminar el dispositivo",
      );
    },
  });
}

export function usePairDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DevicePairingRequest) => deviceService.pair(data),
    onSuccess: () => {
      toast.success("Dispositivo emparejado exitosamente");
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail || "Error al emparejar el dispositivo",
      );
    },
  });
}

export function useUnpairDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deviceService.unpair(id),
    onSuccess: () => {
      toast.success("Dispositivo desvinculado exitosamente");
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() });
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail || "Error al desvincular el dispositivo",
      );
    },
  });
}
