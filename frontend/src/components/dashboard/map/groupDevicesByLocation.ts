import type { DeviceMapItem } from "@/interfaces/device-map.interface";

export interface LocationGroup {
  key: string;
  lat: number;
  lng: number;
  devices: DeviceMapItem[];
}

/** Groups devices sharing coordinates (rounded to 6 decimals), keeping input order. */
export function groupDevicesByLocation(
  devices: DeviceMapItem[],
): LocationGroup[] {
  const groups: Record<string, LocationGroup> = {};
  for (const device of devices) {
    const { lat, lng } = device.location;
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const group = groups[key];
    if (group) {
      group.devices.push(device);
    } else {
      groups[key] = { key, lat, lng, devices: [device] };
    }
  }
  return Object.values(groups);
}
