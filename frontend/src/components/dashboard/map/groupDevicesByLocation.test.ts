import { describe, expect, it } from "vitest";
import type { DeviceMapItem } from "@/interfaces/device-map.interface";
import { groupDevicesByLocation } from "./groupDevicesByLocation";

const device = (overrides: Partial<DeviceMapItem>): DeviceMapItem => ({
  id: "device-1",
  name: "Sensor",
  status: "online",
  ownerId: "owner-1",
  lastMessage: null,
  location: { address: "Calle 1", city: "Córdoba", lat: -31.4, lng: -64.2 },
  ...overrides,
});

describe("groupDevicesByLocation", () => {
  it("keeps devices with distinct coordinates in separate groups", () => {
    const devices = [
      device({ id: "1", location: { address: "A", city: "X", lat: -31.4, lng: -64.2 } }),
      device({ id: "2", location: { address: "B", city: "Y", lat: -34.6, lng: -58.4 } }),
    ];

    const groups = groupDevicesByLocation(devices);

    expect(groups).toHaveLength(2);
    expect(groups[0].devices.map((d) => d.id)).toEqual(["1"]);
    expect(groups[1].devices.map((d) => d.id)).toEqual(["2"]);
  });

  it("groups devices sharing coordinates rounded to 6 decimals, preserving order", () => {
    const devices = [
      device({ id: "1", location: { address: "A", city: "X", lat: -31.4, lng: -64.2 } }),
      device({ id: "2", location: { address: "A", city: "X", lat: -31.4000001, lng: -64.2000001 } }),
      device({ id: "3", location: { address: "B", city: "Y", lat: -34.6, lng: -58.4 } }),
    ];

    const groups = groupDevicesByLocation(devices);

    expect(groups).toHaveLength(2);
    expect(groups[0].devices.map((d) => d.id)).toEqual(["1", "2"]);
    expect(groups[0].lat).toBe(-31.4);
    expect(groups[0].lng).toBe(-64.2);
  });

  it("returns an empty array for no devices", () => {
    expect(groupDevicesByLocation([])).toEqual([]);
  });
});
