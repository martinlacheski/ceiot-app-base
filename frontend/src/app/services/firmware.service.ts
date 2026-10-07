import { appApi } from "@/api/appApi";
import type {
  FirmwarePage,
  FirmwarePageParams,
  FirmwareRelease,
  FirmwareStartRequest,
  FirmwareUpdate,
  FirmwareUploadRequest,
  FirmwareUploadResult,
} from "../types/firmware.types";

/** Query keys of the firmware screens; invalidating `all` refreshes every one of them. */
export const firmwareKeys = {
  all: ["firmware"] as const,
  releases: () => [...firmwareKeys.all, "releases"] as const,
  activeReleases: () => [...firmwareKeys.all, "releases", "active"] as const,
  deviceUpdates: (deviceId: string) => [...firmwareKeys.all, "updates", deviceId] as const,
};

export const firmwareService = {
  listReleases: async (params: { active?: boolean } = {}) => {
    const { data } = await appApi.get<FirmwareRelease[]>("/firmware/releases", { params });
    return data;
  },

  pageReleases: async ({ page, perPage, search, active, sort }: FirmwarePageParams = {}) => {
    const { data } = await appApi.get<FirmwarePage>("/firmware/releases/page", {
      params: { page, per_page: perPage, search, active, sort },
    });
    return data;
  },

  uploadRelease: async ({ file, version, notes, deactivatePrevious }: FirmwareUploadRequest) => {
    const form = new FormData();
    form.append("file", file);
    if (version) form.append("version", version);
    if (notes) form.append("notes", notes);
    if (deactivatePrevious !== undefined) form.append("deactivate_previous", String(deactivatePrevious));
    const { data } = await appApi.post<FirmwareUploadResult>("/firmware/releases", form);
    return data;
  },

  setReleaseActive: async (releaseId: string, active: boolean) => {
    const { data } = await appApi.post<FirmwareRelease>(
      `/firmware/releases/${releaseId}/${active ? "activate" : "deactivate"}`,
    );
    return data;
  },

  startUpdate: async (request: FirmwareStartRequest) => {
    const { data } = await appApi.post<FirmwareUpdate>("/firmware/updates", request);
    return data;
  },

  listUpdates: async (deviceId: string) => {
    const { data } = await appApi.get<FirmwareUpdate[]>(`/firmware/devices/${deviceId}/updates`);
    return data;
  },
};

const STATUS_MESSAGES: Record<number, string> = {
  403: "Solo un administrador puede gestionar el firmware",
  404: "No se encontró el firmware o el dispositivo",
  409: "El dispositivo está sin conexión o ya tiene una actualización en curso",
  413: "El archivo supera el tamaño admitido",
  422: "El archivo o los datos enviados no son válidos",
  503: "El almacenamiento de firmware no está disponible. Intente más tarde.",
};

/** The backend's Spanish `detail` when it sent one (it does for 404/409/422/503), otherwise a
 * message for the HTTP status, otherwise `fallback`. */
export const getFirmwareErrorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { status?: unknown; data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  const status = typeof response?.status === "number" ? response.status : undefined;
  return (status !== undefined && STATUS_MESSAGES[status]) || fallback;
};
