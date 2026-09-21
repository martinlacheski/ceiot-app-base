import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeviceDetailDialog } from "./DeviceDetailDialog";
import type { Device } from "@/app/types/device.types";

const device: Device = {
  id: "device-1",
  serial: "IOT-0000-0001",
  name: "Sensor Norte",
  description: "Monitoreo ambiental",
  deviceTypeId: "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c31",
  status: "active",
  isActive: true,
  enabled: true,
  brokerConnected: false,
};

describe("DeviceDetailDialog", () => {
  it("shows generic device identity without commercial data", () => {
    render(
      <DeviceDetailDialog
        device={device}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Sensor Norte")).toBeInTheDocument();
    expect(screen.getByText("IOT-0000-0001")).toBeInTheDocument();
    expect(screen.queryByText(/dispensador/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Importe:")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$\s/)).not.toBeInTheDocument();
  });
});
