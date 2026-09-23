import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Device } from "@/app/types/device.types";
import {
  buildDeviceMapSearchUrl,
  formatDeviceLocation,
  getDeviceLocationSourceLabel,
} from "./deviceMap";
import { resolveDeviceEditPath } from "./deviceEditPath";
import { DeviceMobileCard, DevicesTable } from "./DevicesTable";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const useDevicesMock = vi.fn<
  (filters?: unknown, options?: unknown) => {
    data?: { items: Device[]; total: number; pages: number };
    isLoading: boolean;
    isError?: boolean;
    refetch?: () => unknown;
  }
>(() => ({
  data: { items: [], total: 0, pages: 0 },
  isLoading: false,
}));
const exportDevicesMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/hooks/useDevices", () => ({
  useDevices: (filters: unknown, options: unknown) => useDevicesMock(filters, options),
  useDeviceTypes: () => ({ data: { items: [] } }),
  useDeviceManufactureDates: () => ({ data: [] }),
  useDeleteDevice: () => ({ mutateAsync: vi.fn() }),
  useUpdateDevice: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/app/hooks/useEnvironments", () => ({
  useEnvironments: () => ({ data: { items: [] } }),
}));
vi.mock("@/admin/hooks/useUsers", () => ({
  useUsers: () => ({ data: { items: [] } }),
}));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({ user: { id: "owner-1" } }),
}));
vi.mock("@/app/services/device.service", () => ({
  deviceService: { export: exportDevicesMock },
}));
vi.mock("./DeviceDetailDialog", () => ({ DeviceDetailDialog: () => null }));

const baseDevice: Device = {
  id: "device-1",
  serial: "IOT-001",
  name: "Surtidor Norte",
  deviceTypeId: "type-1",
  status: "active",
  isActive: true,
  enabled: true,
  brokerConnected: true,
  model: "D-200",
  lastConnection: "2026-07-14T12:00:00Z",
  type: { id: "type-1", name: "Dos relés", isActive: true },
  environment: {
    id: "env-1",
    name: "Estación Centro",
    ownerId: "owner-1",
    ownerName: "Ada Lovelace",
  },
};

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}</output>
      <button onClick={() => navigate(-1)}>Volver en historial</button>
    </>
  );
}

describe("resolveDeviceEditPath", () => {
  it("routes admin edits to the admin form", () => {
    expect(resolveDeviceEditPath("admin", "device-1")).toBe(
      "/admin/devices/device-1/edit",
    );
  });

  it("routes user edits to the app edit form", () => {
    expect(resolveDeviceEditPath("user", "device-1")).toBe(
      "/app/devices/device-1/edit",
    );
  });
});

describe("DeviceMobileCard", () => {
  const handlers = {
    onView: vi.fn(),
    onEdit: vi.fn(),
    onOperations: vi.fn(),
    onDelete: vi.fn(),
    onReactivate: vi.fn(),
  };

  it("avoids duplicating the active status and keeps connectivity in one row", () => {
    const { rerender } = render(
      <DeviceMobileCard device={baseDevice} mode="admin" currentUserId="admin-1" {...handlers} />,
    );

    expect(screen.getByText("Surtidor Norte")).toBeInTheDocument();
    expect(screen.getByText("IOT-001")).toBeInTheDocument();
    expect(screen.getByText(/Estación Centro/)).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText(/Dos relés/)).toBeInTheDocument();
    expect(screen.getByText(/D-200/)).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.queryByText("ACTIVO")).not.toBeInTheDocument();

    const connectionRow = screen.getByLabelText(
      "Conectividad y última conexión",
    );
    expect(within(connectionRow).getByText("En línea")).toBeInTheDocument();
    expect(
      within(connectionRow).getByText(/Última conexión:/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/MQTT/i)).not.toBeInTheDocument();

    rerender(
      <DeviceMobileCard
        device={{
          ...baseDevice,
          status: "maintenance",
          isActive: false,
          brokerConnected: false,
          lastConnection: undefined,
        }}
        mode="admin"
        currentUserId="admin-1"
        {...handlers}
      />,
    );
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText("MANTENIMIENTO")).toBeInTheDocument();

    const fallbackConnectionRow = screen.getByLabelText(
      "Conectividad y última conexión",
    );
    expect(
      within(fallbackConnectionRow).getByText("Fuera de línea"),
    ).toBeInTheDocument();
    expect(
      within(fallbackConnectionRow).getByText(
        "Última conexión: Sin registros",
      ),
    ).toBeInTheDocument();

    rerender(
      <DeviceMobileCard
        device={{ ...baseDevice, brokerConnected: null }}
        mode="admin"
        currentUserId="admin-1"
        {...handlers}
      />,
    );

    const unavailableConnectionRow = screen.getByLabelText(
      "Conectividad y última conexión",
    );
    expect(
      within(unavailableConnectionRow).getByText("No disponible"),
    ).toBeInTheDocument();
    expect(
      within(unavailableConnectionRow).queryByText("Fuera de línea"),
    ).not.toBeInTheDocument();
  });

  it("keeps the primary action visible and places admin actions in the accessible menu", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DeviceMobileCard device={baseDevice} mode="admin" currentUserId="admin-1" {...handlers} />,
    );

    expect(screen.getByRole("button", { name: "Ver detalle" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Más acciones para Surtidor Norte" }));
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Operaciones" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(handlers.onDelete).toHaveBeenCalledWith("device-1");

    rerender(
      <DeviceMobileCard device={{ ...baseDevice, isActive: false }} mode="admin" currentUserId="admin-1" {...handlers} />,
    );
    await user.click(screen.getByRole("button", { name: "Más acciones para Surtidor Norte" }));
    expect(screen.queryByRole("menuitem", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Habilitar" })).toBeInTheDocument();
  });

  it("preserves owner edit permissions and user operations inside the menu", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DeviceMobileCard device={baseDevice} mode="user" currentUserId="owner-1" {...handlers} />,
    );
    expect(screen.queryByText(/Ada Lovelace/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Más acciones para Surtidor Norte" }));
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Operaciones" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Eliminar" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    rerender(
      <DeviceMobileCard device={baseDevice} mode="user" currentUserId="guest-1" {...handlers} />,
    );
    await user.click(screen.getByRole("button", { name: "Más acciones para Surtidor Norte" }));
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Operaciones" })).toBeInTheDocument();
  });
});

describe("DevicesTable responsive contract", () => {
  beforeEach(() => {
    useDevicesMock.mockReset();
    useDevicesMock.mockReturnValue({
      data: { items: [], total: 0, pages: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("uses the same accented enabled label as device exports", () => {
    useDevicesMock.mockReturnValue({
      data: { items: [baseDevice], total: 1, pages: 1 },
      isLoading: false,
    });
    render(<MemoryRouter><DevicesTable mode="admin" /></MemoryRouter>);
    expect(within(screen.getByRole("table")).getByText("Sí")).toBeInTheDocument();
  });

  it.each(["admin", "user"] as const)(
    "aligns export actions to the right in %s mode",
    (mode) => {
      render(
        <MemoryRouter>
          <DevicesTable mode={mode} />
        </MemoryRouter>,
      );

      const exportActions = screen.getByRole("button", { name: "Excel" }).parentElement;
      expect(exportActions).toContainElement(
        screen.getByRole("button", { name: "PDF" }),
      );
      expect(exportActions?.parentElement).toHaveClass("flex", "justify-end");
    },
  );

  it("keeps filters and the injected action grouped at every breakpoint", () => {
    render(
      <MemoryRouter>
        <DevicesTable actions={<button>Nuevo Dispositivo</button>} />
      </MemoryRouter>,
    );

    const filters = screen.getByRole("button", { name: /Filtros/ });
    const action = screen.getByRole("button", { name: "Nuevo Dispositivo" });
    const actionsRow = filters.parentElement;

    expect(actionsRow).toBe(action.parentElement?.parentElement);
    expect(actionsRow).toHaveClass("flex-wrap", "gap-2");
    expect(actionsRow).not.toHaveClass("justify-between", "md:justify-between");
    expect(action.parentElement).not.toHaveClass("ml-auto", "md:ml-auto");
  });

  it("renders independent mobile loading and empty states while retaining the desktop table", () => {
    useDevicesMock.mockReturnValueOnce({ data: { items: [], total: 0, pages: 0 }, isLoading: true });
    const { rerender } = render(<MemoryRouter><DevicesTable /></MemoryRouter>);

    const cards = screen.getByTestId("device-cards");
    expect(within(cards).getByText("Cargando dispositivos")).toBeInTheDocument();
    expect(document.querySelector(".md\\:block table")).toBeInTheDocument();
    expect(cards).toHaveClass("md:hidden");

    useDevicesMock.mockReturnValue({ data: { items: [], total: 0, pages: 0 }, isLoading: false });
    rerender(<MemoryRouter><DevicesTable /></MemoryRouter>);
    expect(within(screen.getByTestId("device-cards")).getByText("No se encontraron resultados.")).toBeInTheDocument();
  });

  it("falls back from invalid URL sorting and resets the page when sorting changes", async () => {
    const user = userEvent.setup();
    const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

    render(
      <MemoryRouter initialEntries={["/devices?page=4&sortBy=unsafe&sortOrder=sideways"]}>
        <DevicesTable />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(useDevicesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "name", sortOrder: "asc" }),
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    const sortSelect = screen.getByRole("combobox", { name: "Ordenar por" });
    fireEvent.keyDown(sortSelect, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Última conexión" }));

    expect(screen.getByTestId("location")).toHaveTextContent("page=1");
    expect(screen.getByTestId("location")).toHaveTextContent("sortBy=lastConnection");
  });

  it("wires sortable headers to the URL-backed server sort", async () => {
    const user = userEvent.setup();
    useDevicesMock.mockReturnValue({
      data: {
        items: [
          { ...baseDevice, id: "2", name: "Zulu" },
          { ...baseDevice, id: "1", name: "Alpha" },
        ],
        total: 2,
        pages: 1,
      },
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/devices?page=4"]}>
        <DevicesTable mode="user" />
        <NavigationProbe />
      </MemoryRouter>,
    );

    const cards = Array.from(
      screen.getByTestId("device-cards").querySelectorAll('[data-slot="card-title"]'),
    );
    expect(cards.map((card) => card.textContent)).toEqual(["Zulu", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Dispositivo" }));
    await user.click(screen.getByRole("menuitem", { name: "Desc" }));
    expect(screen.getByTestId("location")).toHaveTextContent("page=1");
    expect(screen.getByTestId("location")).toHaveTextContent("sortBy=name");
    expect(screen.getByTestId("location")).toHaveTextContent("sortOrder=desc");
  });

  it("does not expose sorting for columns unsupported by the server", () => {
    render(<MemoryRouter><DevicesTable /></MemoryRouter>);

    expect(screen.queryByRole("button", { name: "Lote" })).not.toBeInTheDocument();
  });

  it("uses the shared search and export actions", async () => {
    exportDevicesMock.mockResolvedValue(undefined);
    render(<MemoryRouter><DevicesTable /></MemoryRouter>);

    expect(
      screen.getByPlaceholderText("Buscar en todos los campos..."),
    ).toHaveAttribute("data-list-toolbar-search-control");
    await userEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(exportDevicesMock).toHaveBeenCalledWith(
      "excel",
      expect.objectContaining({ page: 1, sortBy: "name", sortOrder: "asc" }),
      expect.anything(),
    );
  });

  it("clears active sorting and filters back to stable defaults", async () => {
    const user = userEvent.setup();
    const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

    render(
      <MemoryRouter initialEntries={["/devices?page=3&ownerId=owner-2&sortBy=serial&sortOrder=desc"]}>
        <DevicesTable />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));

    expect(screen.getByTestId("location")).toHaveTextContent("page=1");
    expect(screen.getByTestId("location")).toHaveTextContent("sortBy=name");
    expect(screen.getByTestId("location")).toHaveTextContent("sortOrder=asc");
    expect(screen.getByTestId("location")).not.toHaveTextContent("ownerId");
  });

  it.each(["admin", "user"] as const)(
    "shows a retryable load error in %s mode",
    async (mode) => {
      const user = userEvent.setup();
      const refetch = vi.fn();
      useDevicesMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch,
      });

      render(<MemoryRouter><DevicesTable mode={mode} /></MemoryRouter>);

      expect(screen.getByText("No se pudieron cargar los datos.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Reintentar" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    },
  );

  it("uses valid defaults for invalid page and size URL parameters", () => {
    render(
      <MemoryRouter initialEntries={["/devices?page=abc&size=0"]}>
        <DevicesTable />
      </MemoryRouter>,
    );

    expect(useDevicesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, perPage: 10 }),
      expect.anything(),
    );
  });

  it("replaces an out-of-range page when an empty current page still reports results", async () => {
    useDevicesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { rerender } = render(
      <MemoryRouter
        initialEntries={["/previous", "/devices?page=99&size=10"]}
        initialIndex={1}
      >
        <DevicesTable />
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location")).toHaveTextContent("page=99");

    useDevicesMock.mockReturnValue({
      data: { items: [], total: 21, pages: 3 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter
        initialEntries={["/previous", "/devices?page=99&size=10"]}
        initialIndex={1}
      >
        <DevicesTable />
        <NavigationProbe />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("page=3"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Volver en historial" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/previous");
  });
});

describe("buildDeviceMapSearchUrl", () => {
  const baseDevice: Device = {
    id: "device-1",
    serial: "IOT-001",
    name: "Device 1",
    deviceTypeId: "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c31",
    status: "active",
    isActive: true,
    enabled: true,
    brokerConnected: false,
    type: {
      id: "6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c31",
      name: "1 Relé",
      isActive: true,
    },
  };

  it("builds a Google Maps search URL from reported GPS", () => {
    expect(
      buildDeviceMapSearchUrl({
        ...baseDevice,
        gpsLatitude: -34.6037,
        gpsLongitude: -58.3816,
        effectiveLocation: "-34.6037,-58.3816",
        effectiveLocationSource: "device_gps",
      }),
    ).toBe(
      "https://www.google.com/maps/search/?api=1&query=-34.6037%2C-58.3816",
    );
  });

  it("falls back to environment location for map searches and display", () => {
    const device: Device = {
      ...baseDevice,
      effectiveLocation: "Av. Siempre Viva 742",
      effectiveLocationSource: "environment",
      environment: {
        id: "env-1",
        name: "Env 1",
        location: "Av. Siempre Viva 742",
      },
    };

    expect(formatDeviceLocation(device)).toBe("Av. Siempre Viva 742");
    expect(getDeviceLocationSourceLabel(device)).toBe("Establecimiento");
    expect(buildDeviceMapSearchUrl(device)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Av.%20Siempre%20Viva%20742",
    );
  });

  it("returns null when the device has no complete GPS", () => {
    expect(buildDeviceMapSearchUrl(baseDevice)).toBeNull();
    expect(
      buildDeviceMapSearchUrl({ ...baseDevice, gpsLatitude: -34.6037 }),
    ).toBeNull();
    expect(formatDeviceLocation(baseDevice)).toBe("-");
    expect(getDeviceLocationSourceLabel(baseDevice)).toBeNull();
  });
});
