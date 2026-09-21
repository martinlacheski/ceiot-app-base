export type DeviceConnectionStatus = "online" | "offline";

export interface DeviceMapItem {
  id: string;
  name: string;
  location: {
    city: string;
    address: string;
    lat: number;
    lng: number;
  };
  status: DeviceConnectionStatus;
  lastMessage: Date | null;
  ownerId: string;
}
