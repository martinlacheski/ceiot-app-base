import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import UserDevicesPage from "./UserDevicesPage";

vi.mock("@/app/components/devices/DevicesTable", () => ({
  DevicesTable: ({ actions }: { actions?: React.ReactNode }) => (
    <div data-testid="devices-table">{actions}</div>
  ),
}));

const authState = { isAdmin: false };

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { isAdmin: () => boolean }) => unknown) =>
    selector({ isAdmin: () => authState.isAdmin }),
}));

describe("UserDevicesPage", () => {
  it("presenta la vista como propia para un usuario común", () => {
    authState.isAdmin = false;
    render(
      <MemoryRouter>
        <UserDevicesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Mis Dispositivos" })).toBeInTheDocument();
    expect(screen.getByText(/Gestiona tus dispositivos/)).toBeInTheDocument();
  });

  it("presenta la vista completa sin afirmar propiedad para un administrador", () => {
    authState.isAdmin = true;
    render(
      <MemoryRouter>
        <UserDevicesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Vista de Dispositivos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mis Dispositivos" })).not.toBeInTheDocument();
    expect(screen.queryByText(/tus dispositivos/i)).not.toBeInTheDocument();
  });

  it("conserva solo la acción disponible para asociar dispositivos", () => {
    authState.isAdmin = false;
    render(
      <MemoryRouter>
        <UserDevicesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Asociar Dispositivo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Historial de dispositivos/i })).not.toBeInTheDocument();
  });
});
