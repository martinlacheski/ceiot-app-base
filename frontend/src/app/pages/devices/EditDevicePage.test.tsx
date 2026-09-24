import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import EditDevicePage from "./EditDevicePage";

const DEFAULT_DEVICE_TYPE_ID = "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { canManageGuests: true } }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/app/components/access/DeviceGuestManagementCard", () => ({
  DeviceGuestManagementCard: () => <div>Gestión de invitados por dispositivo</div>,
}));

vi.mock("@/app/hooks/useDevices", () => ({
  useDevice: () => ({
    data: {
      id: "device-1",
      serial: "IOT-0000-0001",
      name: "Sensor Norte",
      description: "Monitoreo ambiental",
      deviceTypeId: DEFAULT_DEVICE_TYPE_ID,
      status: "active",
      isActive: true,
      enabled: true,
      environmentId: "env-1",
      type: {
        id: DEFAULT_DEVICE_TYPE_ID,
        name: "Ambiental",
        isActive: true,
      },
      environment: {
        ownerId: "owner-1",
      },
    },
    isLoading: false,
  }),
  useUpdateDevice: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUnpairDevice: () => ({
    mutateAsync: vi.fn(),
  }),
  useDeviceTypes: () => ({
    data: {
      items: [
        {
          id: DEFAULT_DEVICE_TYPE_ID,
          name: "Ambiental",
          is_active: true,
        },
      ],
      total: 1,
      page: 1,
      per_page: 100,
      pages: 1,
    },
  }),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: { id: string; isAdmin: boolean } }) => unknown) =>
    selector({ user: { id: "owner-1", isAdmin: false } }),
}));

describe("EditDevicePage", () => {
  it("shows the user edit flow with the requested fields and without temperature fields", () => {
    render(
      <MemoryRouter initialEntries={["/app/devices/device-1/edit"]}>
        <Routes>
          <Route
            path="/app/devices/:id/edit"
            element={<EditDevicePage mode="user" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /editar dispositivo/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("IOT-0000-0001")).toBeInTheDocument();
    expect(screen.getByText("Tipo de Dispositivo")).toBeInTheDocument();
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.queryByText(/comisión/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText("Habilitado")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /desvincular dispositivo/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tiempo (seg.)")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Temperatura Mínima (°C)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Temperatura Máxima (°C)"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Gestión de invitados por dispositivo"),
    ).toBeInTheDocument();
  });
});
