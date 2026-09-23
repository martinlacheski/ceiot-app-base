import type { Device } from "@/app/types/device.types";
import { getDeviceLocationSourceCodeLabel } from "@/utils/status-labels";

export function getDeviceEffectiveLocation(device: Device): string | null {
  const effectiveLocation = device.effectiveLocation?.trim();
  if (effectiveLocation) return effectiveLocation;

  if (device.gpsLatitude != null && device.gpsLongitude != null) {
    return `${device.gpsLatitude},${device.gpsLongitude}`;
  }

  const environmentLocation = device.environment?.location?.trim();
  return environmentLocation || null;
}

export function getDeviceLocationSourceLabel(device: Device): string | null {
  const source = device.effectiveLocationSource;
  if (source === "device_gps" || source === "environment") {
    return getDeviceLocationSourceCodeLabel(source);
  }

  if (device.gpsLatitude != null && device.gpsLongitude != null) {
    return "GPS";
  }

  if (device.environment?.location?.trim()) {
    return "Establecimiento";
  }

  return null;
}

export function formatDeviceLocation(device: Device): string {
  return getDeviceEffectiveLocation(device) ?? "-";
}

export function buildDeviceMapSearchUrl(device: Device): string | null {
  const location = getDeviceEffectiveLocation(device);
  if (!location) return null;

  const query = encodeURIComponent(location);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
