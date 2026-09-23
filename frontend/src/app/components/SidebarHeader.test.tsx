import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/auth/store/auth.store";
import { SidebarHeader } from "./SidebarHeader";

vi.mock("@/auth/store/auth.store");
vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: vi.fn(),
}));

describe("SidebarHeader", () => {
  const logout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra una identidad clara del usuario en el disparador del menú", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: {
          fullName: "Usuario Demo",
          username: "udemo",
          email: "usuario@example.com",
        },
        logout,
        isAdmin: () => false,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter>
        <SidebarHeader />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: /Usuario Demo usuario@example.com/i }),
    ).toBeInTheDocument();
  });

  it("no muestra el buscador del encabezado", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: {
          fullName: "Usuario Demo",
          username: "udemo",
          email: "usuario@example.com",
        },
        logout,
        isAdmin: () => false,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter>
        <SidebarHeader />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("textbox", { name: /buscar/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Buscar...")).not.toBeInTheDocument();
  });

  it("mantiene el menú de perfil desde el nuevo control de usuario", async () => {
    const user = userEvent.setup();

    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: {
          fullName: "Admin Demo",
          username: "admin",
          email: "admin@example.com",
        },
        logout,
        isAdmin: () => true,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter>
        <SidebarHeader />
      </MemoryRouter>,
    );

    expect(screen.getByText("Administrador")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Admin Demo/i }));

    expect(
      screen.getByRole("menuitem", { name: /Información Personal/i }),
    ).toHaveAttribute("href", "/app/profile");
    expect(
      screen.getByRole("menuitem", { name: /Cambiar Contraseña/i }),
    ).toHaveAttribute("href", "/app/change-password");
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(screen.queryByText("Permisos")).not.toBeInTheDocument();
  });

  it("offers the light/dark theme toggle next to the account menu", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: {
          fullName: "Usuario Demo",
          username: "udemo",
          email: "usuario@example.com",
        },
        logout,
        isAdmin: () => false,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter>
        <SidebarHeader />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: /Cambiar a modo/i }),
    ).toBeInTheDocument();
  });
});
