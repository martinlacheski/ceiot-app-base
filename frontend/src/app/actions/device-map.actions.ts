import { appApi } from "@/api/appApi";
import type {
  DeviceConnectionStatus,
  DeviceMapItem,
} from "@/interfaces/device-map.interface";

interface DeviceApiResponse {
  id: string;
  name: string;
  last_connection: string | null;
  lastConnection?: string | null;
  broker_connected: boolean;
  brokerConnected?: boolean;
  broker_status_updated_at: string | null;
  brokerStatusUpdatedAt?: string | null;
  environment?: {
    address: string;
    location: string;
    city?: { name: string };
    owner_id?: string;
    ownerId?: string;
  };
}

export const getDevicesForMapAction = async (): Promise<DeviceMapItem[]> => {
  const { data } = await appApi.get("/devices", {
    params: { per_page: 100 },
  });

  return data.items.map((device: DeviceApiResponse): DeviceMapItem => {
    const brokerConnected = device.brokerConnected ?? device.broker_connected;
    const brokerStatusUpdatedAt =
      device.brokerStatusUpdatedAt ?? device.broker_status_updated_at;
    const lastConnection = device.lastConnection ?? device.last_connection;
    const location = device.environment?.location ?? "";
    const [rawLat, rawLng] = location.split(",");
    const parsedLat = Number.parseFloat(rawLat);
    const parsedLng = Number.parseFloat(rawLng);
    const status: DeviceConnectionStatus = brokerConnected
      ? "online"
      : "offline";

    return {
      id: device.id,
      name: device.name,
      location: {
        lat: Number.isFinite(parsedLat) ? parsedLat : 0,
        lng: Number.isFinite(parsedLng) ? parsedLng : 0,
        address: device.environment?.address || "Sin ubicación",
        city: device.environment?.city?.name || "Sin ciudad",
      },
      status,
      lastMessage: brokerStatusUpdatedAt
        ? new Date(brokerStatusUpdatedAt)
        : lastConnection
          ? new Date(lastConnection)
          : null,
      ownerId:
        device.environment?.ownerId ||
        device.environment?.owner_id ||
        "unknown",
    };
  });
};
