import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router";

import type { Environment } from "@/app/types/environment.types";
import { EnvironmentMobileCard, EnvironmentsTable } from "./EnvironmentsTable";

Element.prototype.scrollIntoView = vi.fn();

const useEnvironmentsMock = vi.fn<(filters?: unknown) => {
  data?: { items: Environment[]; total: number; pages: number };
  isLoading: boolean;
  isError?: boolean;
  refetch?: () => unknown;
}>(() => ({
  data: { items: [], total: 0, pages: 0 },
  isLoading: false,
}));

vi.mock("@/app/hooks/useEnvironments", () => ({
  useEnvironments: (filters: unknown) => useEnvironmentsMock(filters),
  useEnvironmentTypes: () => ({ data: { items: [] } }),
  useDeleteEnvironment: () => ({ mutateAsync: vi.fn() }),
  useUpdateEnvironment: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: () => ({ data: { items: [] } }),
  useStates: () => ({ data: { items: [] } }),
  useCities: () => ({ data: { items: [] } }),
}));
vi.mock("@/admin/hooks/useUsers", () => ({
  useUsers: () => ({ data: { items: [] } }),
}));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({ user: { id: "admin-1", isAdmin: true } }),
}));
vi.mock("@/app/services/environment.service", () => ({
  environmentService: { export: vi.fn() },
}));
vi.mock("./EnvironmentDetailDialog", () => ({
  EnvironmentDetailDialog: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="URL actual">{location.search}</output>;
}

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="URL actual">{location.pathname}{location.search}</output>
      <button onClick={() => navigate(-1)}>Volver en historial</button>
    </>
  );
}

const environment: Environment = {
  id: "environment-1",
  name: "Estación Centro",
  address: "Av. Siempre Viva 742",
  location: "-34.6037,-58.3816",
  description: "",
  cityId: "city-1",
  typeId: "type-1",
  isActive: true,
  ownerId: "owner-1",
  ownerName: "Ada Lovelace",
  currentUserRole: "owner",
  type: { id: "type-1", name: "Estación de servicio" },
};

const handlers = {
  onView: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onReactivate: vi.fn(),
};

describe("EnvironmentMobileCard", () => {
  it("shows domain details and exposes the primary and permitted actions", async () => {
    const user = userEvent.setup();
    render(
      <EnvironmentMobileCard
        environment={{ ...environment, canEdit: true, canDelete: true }}
        currentUserId="owner-1"
        {...handlers}
      />,
    );

    expect(screen.getByText("Estación Centro")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText(/Estación de servicio/)).toBeInTheDocument();
    expect(screen.getByText(/Propietario/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver ubicación" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-34.6037,-58.3816",
    );

    await user.click(screen.getByRole("button", { name: "Ver detalles" }));
    expect(handlers.onView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "environment-1" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Más acciones para Estación Centro" }),
    );
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(handlers.onDelete).toHaveBeenCalledWith("environment-1");
  });

  it("hides restricted actions and offers reactivation only for inactive records", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EnvironmentMobileCard
        environment={{ ...environment, canEdit: false, canDelete: false }}
        currentUserId="guest-1"
        {...handlers}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Más acciones/ }),
    ).not.toBeInTheDocument();

    rerender(
      <EnvironmentMobileCard
        environment={{ ...environment, isActive: false, canDelete: true }}
        currentUserId="guest-1"
        {...handlers}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Más acciones para Estación Centro" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Eliminar" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Habilitar" }));
    expect(handlers.onReactivate).toHaveBeenCalledWith("environment-1");
  });
});

describe("EnvironmentsTable server-side sorting", () => {
  beforeEach(() => {
    useEnvironmentsMock.mockReset();
    useEnvironmentsMock.mockReturnValue({
      data: { items: [], total: 0, pages: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("keeps search on its own row and aligns filters with the primary action", () => {
    render(
      <MemoryRouter>
        <EnvironmentsTable actions={<button>Nuevo Establecimiento</button>} />
      </MemoryRouter>,
    );

    const searchRow = screen.getByTestId("environment-search-row");
    const actionsRow = screen.getByTestId("environment-actions-row");

    expect(within(searchRow).getByPlaceholderText("Buscar en todos los campos...")).toBeInTheDocument();
    expect(within(searchRow).queryByRole("button", { name: /Filtros/ })).not.toBeInTheDocument();
    expect(within(actionsRow).getByRole("button", { name: /Filtros/ })).toBeInTheDocument();
    expect(within(actionsRow).getByRole("button", { name: "Nuevo Establecimiento" })).toBeInTheDocument();
    expect(actionsRow).toHaveClass("flex-wrap", "gap-2");
    expect(actionsRow).not.toHaveClass("justify-between");
    expect(
      within(actionsRow).getByRole("button", { name: "Nuevo Establecimiento" }).parentElement,
    ).not.toHaveClass("ml-auto");

    const exportActions = screen.getByRole("button", { name: "Excel" }).parentElement;
    expect(exportActions).toContainElement(
      screen.getByRole("button", { name: "PDF" }),
    );
    expect(exportActions?.parentElement).toHaveClass("flex", "justify-end");
  });

  it("falls back to valid defaults when the URL contains invalid sorting", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/?sortBy=invalid&sortOrder=sideways"]}>
        <EnvironmentsTable />
      </MemoryRouter>,
    );

    expect(useEnvironmentsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "name", sortOrder: "asc" }),
    );

    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    const sortControls = screen.getAllByRole("combobox").slice(0, 2);
    expect(sortControls[0]).toHaveTextContent("Nombre");
    expect(sortControls[1]).toHaveTextContent("Ascendente");
  });

  it("reads sorting from the URL and clearing filters restores defaults and page one", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/?page=4&sortBy=owner&sortOrder=desc"]}>
        <EnvironmentsTable />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(useEnvironmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "owner", sortOrder: "desc", page: 4 }),
    );

    await user.click(screen.getByRole("button", { name: /Filtros/ }));
    const sortControls = screen.getAllByRole("combobox").slice(0, 2);
    expect(sortControls[0]).toHaveTextContent("Dueño");
    expect(sortControls[1]).toHaveTextContent("Descendente");
    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "URL actual" })).toHaveTextContent(
        "?status=active&size=10&page=1&sortBy=name&sortOrder=asc",
      ),
    );
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "name", sortOrder: "asc", page: 1 }),
    );
  });

  it("shows a retryable load error", async () => {
    const refetch = vi.fn();
    useEnvironmentsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<MemoryRouter><EnvironmentsTable /></MemoryRouter>);

    expect(screen.getByText("No se pudieron cargar los datos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("uses valid defaults for invalid page and size URL parameters", () => {
    render(
      <MemoryRouter initialEntries={["/?page=abc&size=0"]}>
        <EnvironmentsTable />
      </MemoryRouter>,
    );

    expect(useEnvironmentsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, perPage: 10 }),
    );
  });

  it("replaces an out-of-range page when an empty current page still reports results", async () => {
    useEnvironmentsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { rerender } = render(
      <MemoryRouter initialEntries={["/previous", "/?page=99&size=10"]} initialIndex={1}>
        <EnvironmentsTable />
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status", { name: "URL actual" })).toHaveTextContent("page=99");

    useEnvironmentsMock.mockReturnValue({
      data: { items: [], total: 21, pages: 3 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/previous", "/?page=99&size=10"]} initialIndex={1}>
        <EnvironmentsTable />
        <NavigationProbe />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "URL actual" })).toHaveTextContent("page=3"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Volver en historial" }));
    expect(screen.getByRole("status", { name: "URL actual" })).toHaveTextContent("/previous");
  });
});
