import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Device } from "@/app/types/device.types";

import { DeviceEstablishmentBlock } from "./DeviceEstablishmentBlock";

const openDialogSpy = vi.fn();

vi.mock("@/app/components/devices/MoveDeviceDialog", () => ({
  MoveDeviceDialog: ({ open }: { open: boolean }) => {
    openDialogSpy(open);
    return open ? <div data-testid="move-dialog-open" /> : null;
  },
}));

const device = {
  id: "device-1",
  serial: "IOT-0000-0001",
  name: "Sensor Norte",
  environmentId: "env-1",
  environment: { id: "env-1", name: "Casa Central", ownerName: "Ana" },
} as Device;

describe("DeviceEstablishmentBlock", () => {
  it("shows the current establishment and its owner", () => {
    render(<DeviceEstablishmentBlock device={device} />);

    expect(screen.getByText("Casa Central")).toBeInTheDocument();
    expect(screen.getByText(/propietario: ana/i)).toBeInTheDocument();
  });

  it("shows a dash when the device has no establishment", () => {
    render(
      <DeviceEstablishmentBlock
        device={{ ...device, environment: undefined } as Device}
      />,
    );

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("opens the move dialog when the action button is clicked", async () => {
    const user = userEvent.setup();
    render(<DeviceEstablishmentBlock device={device} />);

    expect(screen.queryByTestId("move-dialog-open")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /mover a otro establecimiento/i }),
    );

    expect(screen.getByTestId("move-dialog-open")).toBeInTheDocument();
  });

  it("disables the move action when moveDisabled is set", () => {
    render(<DeviceEstablishmentBlock device={device} moveDisabled />);

    expect(
      screen.getByRole("button", { name: /mover a otro establecimiento/i }),
    ).toBeDisabled();
  });
});
