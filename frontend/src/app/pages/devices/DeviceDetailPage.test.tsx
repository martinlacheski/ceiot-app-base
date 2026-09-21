import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import DeviceDetailPage from "./DeviceDetailPage";

const guestCardMock = vi.hoisted(() => vi.fn<(props: Record<string, unknown>) => void>());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      id: "device-1",
      name: "Environmental sensor",
      serial: "SENSOR-001",
      environment: { id: "env-1", name: "Greenhouse", ownerId: "owner-1" },
    },
  }),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({ user: { id: "owner-1" } }),
}));

vi.mock("@/app/components/access/DeviceGuestManagementCard", () => ({
  DeviceGuestManagementCard: (props: Record<string, unknown>) => {
    guestCardMock(props);
    return <div>Access management</div>;
  },
}));

describe("DeviceDetailPage access wiring", () => {
  it("passes only access identity and ownership to guest management", () => {
    render(
      <MemoryRouter initialEntries={["/app/devices/device-1"]}>
        <Routes>
          <Route path="/app/devices/:id" element={<DeviceDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Access management")).toBeInTheDocument();
    expect(guestCardMock).toHaveBeenCalledWith({ deviceId: "device-1", isOwner: true });
  });
});
