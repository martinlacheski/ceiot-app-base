import type { Device } from "@/app/types/device.types";
import { formatDateTime } from "@/utils/date.utils";

type DeviceTelemetrySnapshot = Pick<
  Device,
  "gpsLatitude" | "gpsLongitude" | "gpsUpdatedAt" | "macAddress"
>;

const MISSING_TELEMETRY_LABEL = "Sin reportar";

export function formatDeviceMac(device: DeviceTelemetrySnapshot): string {
  const macAddress = device.macAddress?.trim();
  return macAddress || MISSING_TELEMETRY_LABEL;
}

export function formatDeviceGpsCoordinates(
  device: DeviceTelemetrySnapshot,
): string {
  if (device.gpsLatitude == null || device.gpsLongitude == null) {
    return MISSING_TELEMETRY_LABEL;
  }

  return `${device.gpsLatitude.toFixed(6)}, ${device.gpsLongitude.toFixed(6)}`;
}

export function formatDeviceGpsSummary(device: DeviceTelemetrySnapshot): string {
  const coordinates = formatDeviceGpsCoordinates(device);
  if (coordinates === MISSING_TELEMETRY_LABEL) {
    return coordinates;
  }

  if (!device.gpsUpdatedAt) {
    return coordinates;
  }

  return `${coordinates} · ${formatDateTime(device.gpsUpdatedAt)}`;
}
