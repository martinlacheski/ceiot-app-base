import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";

import { Sidebar } from "./Sidebar";
import { useAuthStore } from "@/auth/store/auth.store";

vi.mock("@/auth/store/auth.store");

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usa la ruta de dispositivos de usuario en /app/devices", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: { id: "u1", fullName: "Usuario Demo" },
        logout: vi.fn(),
        isAdmin: () => false,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Sidebar isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Dispositivos/i })).toHaveAttribute(
      "href",
      "/app/devices",
    );
  });

  it("muestra la ruta admin de dispositivos en /admin/devices", async () => {
    const user = userEvent.setup();

    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: { id: "a1", fullName: "Admin Demo" },
        logout: vi.fn(),
        isAdmin: () => true,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Sidebar isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Ajustes/i }));

    expect(screen.getByRole("link", { name: /Dispositivos/i })).toHaveAttribute(
      "href",
      "/admin/devices",
    );
    expect(screen.queryByRole("link", { name: "Generales" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/settings"]')).toBeNull();
  });

  it("muestra el logo de 64px solo cuando la barra está expandida", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        authStatus: "authenticated",
        user: { id: "u1", fullName: "Usuario Demo" },
        logout: vi.fn(),
        isAdmin: () => false,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/app"]}>
        <Sidebar isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );

    const logo = screen.getByRole("img", { name: /monitoreo ambiental iot/i });
    expect(logo.parentElement).toHaveClass("size-16", "bg-white");

    rerender(
      <MemoryRouter initialEntries={["/app"]}>
        <Sidebar isCollapsed={true} onToggle={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("img", { name: /monitoreo ambiental iot/i })).not.toBeInTheDocument();
  });

  it("omits Mercado Pago navigation for administrators", async () => {
    const user = userEvent.setup();

    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: { id: "a1", fullName: "Admin Demo" },
        logout: vi.fn(),
        isAdmin: () => true,
      };

      return typeof selector === "function"
        ? selector(state as never)
        : (state as never);
    });

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Sidebar isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Ajustes/i }));

    expect(screen.queryByText(/Mercado Pago/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Usuarios vendedores/i }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/admin/mercadopago"]')).toBeNull();
  });
});
