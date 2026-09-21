import { describe, expect, it } from "vitest";

import {
  formatDeviceGpsSummary,
  formatDeviceMac,
} from "./deviceTelemetry";

describe("deviceTelemetry", () => {
  it("returns placeholders when MAC or GPS were not reported", () => {
    expect(formatDeviceMac({ macAddress: null })).toBe("Sin reportar");
    expect(
      formatDeviceGpsSummary({
        gpsLatitude: null,
        gpsLongitude: null,
        gpsUpdatedAt: null,
      }),
    ).toBe("Sin reportar");
  });

  it("formats GPS coordinates and timestamp when present", () => {
    expect(
      formatDeviceGpsSummary({
        gpsLatitude: -27.3621374,
        gpsLongitude: -55.9008742,
        gpsUpdatedAt: "2026-06-04T12:34:56Z",
      }),
    ).toContain("-27.362137, -55.900874");
  });
});
