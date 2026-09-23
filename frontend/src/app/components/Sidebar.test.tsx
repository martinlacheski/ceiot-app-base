import { render, screen, within } from "@testing-library/react";
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

  it("pone Mapa inmediatamente después de Inicio para un usuario común", () => {
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

    const links = within(screen.getByRole("navigation"))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links.slice(0, 4)).toEqual([
      expect.stringContaining("Inicio"),
      expect.stringContaining("Mapa"),
      expect.stringContaining("Mi perfil"),
      expect.stringContaining("Establecimientos"),
    ]);
  });

  it("muestra el logo con el nombre del proyecto y lo oculta al colapsar", () => {
    vi.mocked(useAuthStore).mockImplementation((selector) => {
      const state = {
        user: { id: "u1", fullName: "Usuario Demo" },
        logout: vi.fn(),
        isAdmin: () => false,
        authStatus: "authenticated",
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

    expect(screen.getByText("Monitoreo Ambiental IoT")).toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/app"]}>
        <Sidebar isCollapsed onToggle={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Monitoreo Ambiental IoT")).not.toBeInTheDocument();
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

    expect(screen.getByRole("link", { name: "Dispositivos" })).toHaveAttribute(
      "href",
      "/app/devices",
    );
    expect(screen.getByRole("link", { name: "Historial de dispositivos" })).toHaveAttribute("href", "/app/devices/history");
  });

  it("muestra las vistas operativas de administrador en la raíz y en el orden esperado", () => {
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

    const navigation = screen.getByRole("navigation");
    expect(within(navigation).getByRole("link", { name: "Dispositivos" })).toHaveAttribute(
      "href",
      "/admin/devices",
    );
    expect(within(navigation).getByRole("link", { name: "Vista de dispositivos" })).toHaveAttribute(
      "href",
      "/app/devices",
    );
    expect(within(navigation).getByRole("link", { name: "Historial de dispositivos" })).toHaveAttribute("href", "/app/devices/history");
    expect(within(navigation).getByRole("link", { name: "Usuarios" })).toHaveAttribute(
      "href",
      "/admin/users",
    );

    const links = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links.slice(0, 8)).toEqual([
      expect.stringContaining("Inicio"),
      expect.stringContaining("Mapa"),
      expect.stringContaining("Mi perfil"),
      expect.stringContaining("Establecimientos"),
      expect.stringContaining("Dispositivos"),
      expect.stringContaining("Vista de dispositivos"),
      expect.stringContaining("Historial de dispositivos"),
      expect.stringContaining("Usuarios"),
    ]);
    expect(screen.queryByRole("link", { name: "Generales" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/settings"]')).toBeNull();
  });

  it("mantiene solo configuración dentro de Ajustes", async () => {
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

    expect(screen.getAllByRole("link", { name: "Dispositivos" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Usuarios" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Permisos" })).toHaveAttribute(
      "href",
      "/admin/permissions",
    );
  });

  it("resalta de forma independiente las dos vistas de dispositivos del administrador", () => {
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
      <MemoryRouter initialEntries={["/app/devices"]}>
        <Sidebar isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Vista de dispositivos" })).toHaveClass(
      "border-primary",
    );
    expect(screen.getByRole("link", { name: "Dispositivos" })).not.toHaveClass(
      "border-primary",
    );
  });

  it("muestra el logo centrado de 36px solo cuando la barra está expandida", () => {
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
    expect(logo.parentElement).toHaveClass("size-9");
    expect(logo.parentElement).not.toHaveClass("bg-white");

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
