import type { Device } from "@/app/types/device.types";

export type ReadingsRange = "1h" | "24h" | "7d";

export const READINGS_RANGES: Array<{ id: ReadingsRange; label: string; description: string; hours: number }> = [
  { id: "1h", label: "1h", description: "Última hora", hours: 1 },
  { id: "24h", label: "24h", description: "Últimas 24 horas", hours: 24 },
  { id: "7d", label: "7d", description: "Últimos 7 días", hours: 24 * 7 },
];

/** Recent readings fetched for the records table and the current-values strip. */
export const RECENT_READINGS_LIMIT = 10;

/** ISO bounds of a rolling window that ends at `now`. */
export function resolveReadingsPeriod(range: ReadingsRange, now: number) {
  const hours = READINGS_RANGES.find((option) => option.id === range)?.hours ?? 24;
  return {
    start: new Date(now - hours * 60 * 60 * 1000).toISOString(),
    end: new Date(now).toISOString(),
  };
}

export interface FleetPresence {
  online: number;
  offline: number;
  unknown: number;
}

export function countPresence(devices: Device[]): FleetPresence {
  return devices.reduce<FleetPresence>((counts, device) => {
    if (device.brokerConnected === true) counts.online += 1;
    else if (device.brokerConnected === false) counts.offline += 1;
    else counts.unknown += 1;
    return counts;
  }, { online: 0, offline: 0, unknown: 0 });
}

const PRESENCE_ORDER = (device: Device) =>
  device.brokerConnected === true ? 0 : device.brokerConnected === false ? 1 : 2;

/** Online first, then offline, then devices without presence data; stable within each group. */
export function sortByPresence(devices: Device[]): Device[] {
  return [...devices].sort((a, b) => PRESENCE_ORDER(a) - PRESENCE_ORDER(b));
}

/** The requested device when it is still listed; otherwise the first online one, else the first. */
export function pickSelectedDevice(devices: Device[], requestedId: string | null): Device | undefined {
  return devices.find((device) => device.id === requestedId)
    ?? devices.find((device) => device.brokerConnected === true)
    ?? devices[0];
}

export const deviceLabel = (device: Device) => device.name || device.serial;
