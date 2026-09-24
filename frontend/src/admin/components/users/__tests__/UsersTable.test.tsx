import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { showConfirmDialog } from "@/store/confirm.store";
import { getUsersAction } from "@/admin/actions/user.actions";
import { useDeleteUser, useUpdateUser, useUsers } from "@/admin/hooks/useUsers";
import { exportToPdf } from "@/lib/export.utils";
import { formatDateTime } from "@/utils/date.utils";
import { UsersTable } from "../UsersTable";

const deleteMutate = vi.fn();
const updateMutate = vi.fn();
const users = [
  {
    id: "1",
    username: "testuser",
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    identificationNumber: "12345678",
    isActive: true,
    isAdmin: true,
    permissions: [],
  },
  {
    id: "2",
    username: "inactiveuser",
    email: "inactive@example.com",
    firstName: "Inactive",
    lastName: "User",
    isActive: false,
    isAdmin: false,
    permissions: [],
  },
];

// Mock hooks
vi.mock("@/admin/hooks/useUsers", () => ({
  useUsers: vi.fn(() => ({
    data: {
      items: users,
      total: 2,
      page: 1,
      per_page: 10,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useDeleteUser: vi.fn(() => ({
    mutate: deleteMutate,
  })),
  useUpdateUser: vi.fn(() => ({
    mutate: updateMutate,
  })),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("@/admin/actions/user.actions", () => ({
  getUsersAction: vi.fn(),
}));

vi.mock("../ViewUserDialog", () => ({
  ViewUserDialog: ({
    open,
    user,
  }: {
    open: boolean;
    user: { username: string };
  }) => (open ? <div role="dialog">Detalles de {user.username}</div> : null),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({
    user: { fullName: "Admin User", username: "admin" },
  })),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// Mock export utils
vi.mock("@/lib/export.utils", () => ({
  exportToPdf: vi.fn(),
}));

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function LocationPathname() {
  return (
    <output data-testid="location-pathname">{useLocation().pathname}</output>
  );
}

describe("UsersTable", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUsers).mockReturnValue({
      data: { items: users, total: 2, page: 1, per_page: 10, pages: 1 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useUsers>);
    vi.mocked(useDeleteUser).mockReturnValue({
      mutate: deleteMutate,
    } as unknown as ReturnType<typeof useDeleteUser>);
    vi.mocked(useUpdateUser).mockReturnValue({
      mutate: updateMutate,
    } as unknown as ReturnType<typeof useUpdateUser>);
    vi.mocked(getUsersAction).mockResolvedValue({
      items: users,
      total: users.length,
      page: 1,
      per_page: 10000,
      pages: 1,
    });
  });

  it("renders users correctly", () => {
    render(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );

    const card = screen.getAllByTestId("user-mobile-card")[0];
    expect(within(card).getByText("Test User")).toBeInTheDocument();
    expect(within(card).getByText("@testuser")).toBeInTheDocument();
    expect(within(card).getByText("test@example.com")).toBeInTheDocument();
    expect(within(card).getByText("DNI 12345678")).toBeInTheDocument();
    expect(within(card).getByText("Admin")).toBeInTheDocument();
    expect(within(card).getByText("Activo")).toBeInTheDocument();
  });

  it("uses cards below md and preserves the desktop table at md+", () => {
    render(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("users-mobile-list")).toHaveClass(
      "grid",
      "grid-cols-1",
      "md:hidden",
    );
    expect(screen.getByTestId("users-desktop-table")).toHaveClass(
      "hidden",
      "md:block",
    );
    expect(screen.getAllByTestId("user-mobile-card")).toHaveLength(
      users.length,
    );
    expect(useUsers).toHaveBeenCalledTimes(1);
  });

  it("opens details and navigates to edit from mobile actions", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <UsersTable />
        <LocationPathname />
      </MemoryRouter>,
    );

    const card = screen.getAllByTestId("user-mobile-card")[0];
    await user.click(
      within(card).getByRole("button", { name: "Ver detalles" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Detalles de testuser",
    );

    await user.click(
      within(card).getByRole("button", { name: "Más acciones para testuser" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(screen.getByTestId("location-pathname")).toHaveTextContent(
      "/admin/users/edit/1",
    );
  });

  it("keeps delete and reactivate conditions and confirmations", async () => {
    const user = userEvent.setup();
    vi.mocked(showConfirmDialog).mockImplementation((_message, callback) =>
      callback(),
    );
    render(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );

    const activeCard = screen.getAllByTestId("user-mobile-card")[0];
    await user.click(
      within(activeCard).getByRole("button", {
        name: "Más acciones para testuser",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "Eliminar" })).toHaveClass(
      "min-h-11",
    );
    expect(
      screen.queryByRole("menuitem", { name: "Habilitar usuario" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(showConfirmDialog).toHaveBeenCalledWith(
      "¿Estás seguro de eliminar este usuario?",
      expect.any(Function),
    );
    expect(deleteMutate).toHaveBeenCalledWith("1");

    const inactiveCard = screen.getAllByTestId("user-mobile-card")[1];
    await user.click(
      within(inactiveCard).getByRole("button", {
        name: "Más acciones para inactiveuser",
      }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Habilitar usuario" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Eliminar" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: "Habilitar usuario" }),
    );
    expect(showConfirmDialog).toHaveBeenCalledWith(
      "¿Estás seguro de habilitar este usuario?",
      expect.any(Function),
    );
    expect(updateMutate).toHaveBeenCalledWith({
      id: "2",
      user: { isActive: true },
    });
  });

  it("renders mobile loading and empty equivalents", () => {
    vi.mocked(useUsers).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useUsers>);
    const { rerender } = render(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("user-mobile-skeleton")).toHaveLength(3);

    vi.mocked(useUsers).mockReturnValue({
      data: { items: [], total: 0, page: 1, per_page: 10, pages: 0 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useUsers>);
    rerender(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );
    expect(
      within(screen.getByTestId("users-mobile-list")).getByText(
        "No hay resultados.",
      ),
    ).toBeInTheDocument();
  });

  it("renders export buttons", () => {
    render(
      <MemoryRouter>
        <UsersTable />
      </MemoryRouter>,
    );

    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("uses the normalized server sort when exporting the full filtered result", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/users?page=3&size=25&search=ana&isAdmin=admin&sort=email:desc",
        ]}
      >
        <UsersTable />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "PDF" }));

    expect(getUsersAction).toHaveBeenCalledWith({
      page: 1,
      size: 10000,
      search: "ana",
      isActive: true,
      isAdmin: true,
      sort: "email:desc",
    });
  });

  it("keeps search separate from filters and the primary action", () => {
    render(
      <MemoryRouter>
        <UsersTable actions={<button>Nuevo Usuario</button>} />
      </MemoryRouter>,
    );

    const searchRow = screen.getByTestId("list-toolbar-search");
    const actionsRow = screen.getByTestId("list-toolbar-actions");
    const searchInput = within(searchRow).getByRole("textbox");

    expect(searchInput).toBeVisible();
    expect(searchInput).toHaveAttribute("data-list-toolbar-search-control");
    expect(searchRow).toHaveClass(
      "[&_[data-list-toolbar-search-control]]:min-h-11",
    );
    expect(within(searchRow).queryByText("Filtros")).not.toBeInTheDocument();
    expect(
      within(searchRow).queryByText("Nuevo Usuario"),
    ).not.toBeInTheDocument();
    expect(
      within(actionsRow).getByRole("button", { name: /Filtros/i }),
    ).toBeVisible();
    expect(
      within(actionsRow).getByRole("button", { name: "Nuevo Usuario" }),
    ).toBeVisible();
    expect(within(actionsRow).queryByLabelText("Ordenar por")).not.toBeInTheDocument();
    expect(within(actionsRow).queryByLabelText("Dirección")).not.toBeInTheDocument();
    expect(screen.queryByTestId("users-filter-panel")).not.toBeInTheDocument();
  });

  it("preserves search and filter interactions and exposes an accessible clear action", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/users?size=25&isAdmin=admin"]}>
        <UsersTable />
        <LocationSearch />
      </MemoryRouter>,
    );

    const search = screen.getByPlaceholderText("Buscar en todos los campos...");
    await user.type(search, "ana");
    expect(screen.getByTestId("location-search")).toHaveTextContent("size=25");
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "isAdmin=admin",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "search=ana",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("page=1");

    const clear = screen.getByRole("button", { name: "Limpiar búsqueda" });
    expect(clear).toHaveClass("size-11");
    await user.click(clear);
    expect(search).toHaveValue("");
    expect(screen.getByTestId("location-search")).not.toHaveTextContent(
      "search=",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("size=25");
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "isAdmin=admin",
    );

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    expect(screen.getByText("Filtros avanzados")).toBeVisible();
    const filterPanel = screen.getByTestId("users-filter-panel");
    const filterGrid = within(filterPanel).getByTestId("users-filter-grid");
    expect(within(filterGrid).getByLabelText("Ordenar por")).toBeVisible();
    expect(within(filterGrid).getByLabelText("Dirección")).toBeVisible();
    expect(screen.getAllByRole("combobox")[3]).toHaveValue("admin");
  });

  it("keeps mobile controls, desktop headers, URL state, and server sorting synchronized", async () => {
    const user = userEvent.setup();
    vi.mocked(useUsers).mockReturnValue({
      data: { items: users, total: 40, page: 4, per_page: 10, pages: 4 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useUsers>);
    render(
      <MemoryRouter initialEntries={["/admin/users?page=4&sort=email:desc"]}>
        <UsersTable />
        <LocationSearch />
      </MemoryRouter>,
    );

    expect(useUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 4, sort: "email:desc" }),
    );

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    const filterPanel = screen.getByTestId("users-filter-panel");
    expect(within(filterPanel).getByLabelText("Ordenar por")).toHaveTextContent(
      "Email",
    );
    expect(within(filterPanel).getByLabelText("Dirección")).toHaveTextContent(
      "Descendente",
    );

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "Usuario" }));
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "sort=username%3Adesc",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("page=1");
    expect(useUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, sort: "username:desc" }),
    );

    await user.click(screen.getByRole("button", { name: /Nombre/i }));
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "sort=firstName%3Aasc",
    );
    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Nombre");
    expect(screen.getByLabelText("Dirección")).toHaveTextContent("Ascendente");
  });

  it("marks sorting as an active filter and exposes the clear action", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/users?page=3&size=25"]}>
        <UsersTable />
        <LocationSearch />
      </MemoryRouter>,
    );

    const filtersButton = screen.getByRole("button", { name: "Filtros" });
    expect(within(filtersButton).queryByText("!")).not.toBeInTheDocument();

    await user.click(filtersButton);
    expect(
      screen.queryByRole("button", { name: "Limpiar todos" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toBeDisabled();

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "Email" }));

    expect(within(filtersButton).getByText("!")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Limpiar todos" }),
    ).toBeVisible();
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "sort=email%3Aasc",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("page=1");
  });

  it.each(["", "password:sideways"])(
    "does not send invalid sort %j and normalizes it without dropping valid URL state",
    async (invalidSort) => {
    render(
      <MemoryRouter
        initialEntries={[
          `/admin/users?page=3&size=25&search=ana&isAdmin=admin&sort=${invalidSort}`,
        ]}
      >
        <UsersTable />
        <LocationSearch />
      </MemoryRouter>,
    );

    expect(useUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: undefined }),
    );
    expect(await screen.findByTestId("location-search")).not.toHaveTextContent(
      "sort=",
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("page=1");
    expect(screen.getByTestId("location-search")).toHaveTextContent("size=25");
    expect(screen.getByTestId("location-search")).toHaveTextContent("search=ana");
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "isAdmin=admin",
    );
    },
  );

  it("clears advanced filters and sorting while preserving pagination size", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/users?page=4&size=25&search=ana&isActive=inactive&isAdmin=admin&sort=email:desc",
        ]}
      >
        <UsersTable />
        <LocationSearch />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));

    const locationSearch = screen.getByTestId("location-search");
    expect(locationSearch).toHaveTextContent("page=1");
    expect(locationSearch).toHaveTextContent("size=25");
    expect(locationSearch).toHaveTextContent("isActive=active");
    expect(locationSearch).not.toHaveTextContent("sort=");
    expect(locationSearch).not.toHaveTextContent("search=");
    expect(locationSearch).not.toHaveTextContent("isAdmin=");
    expect(useUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        size: 25,
        search: "",
        isActive: true,
        isAdmin: undefined,
        sort: undefined,
      }),
    );
    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Sin ordenar");
    expect(screen.getByLabelText("Dirección")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Limpiar todos" }),
    ).not.toBeInTheDocument();
  });

  // More interaction tests would go here (e.g. clicking filters)
  // but this verifies the component renders without crashing and shows data.

  describe("last access", () => {
    const NOW = new Date("2026-09-20T12:00:00Z");
    const activityUsers = [
      {
        ...users[0],
        createdAt: "2026-01-10T09:30:00Z",
        updatedAt: "2026-02-11T10:45:00Z",
        lastLoginAt: "2026-09-10T08:00:00Z",
        lastSeenAt: "2026-09-17T12:00:00Z",
      },
      {
        ...users[1],
        createdAt: "2026-03-01T09:30:00Z",
        updatedAt: null,
        lastLoginAt: "2026-09-20T11:55:00Z",
        lastSeenAt: null,
      },
      {
        id: "3",
        username: "neveruser",
        email: "never@example.com",
        isActive: true,
        isAdmin: false,
        permissions: [],
        createdAt: null,
        updatedAt: null,
        lastLoginAt: null,
        lastSeenAt: null,
      },
    ];

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      vi.mocked(useUsers).mockReturnValue({
        data: { items: activityUsers, total: 3, page: 1, size: 10, pages: 1 },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useUsers>);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const renderTable = () =>
      render(
        <MemoryRouter>
          <UsersTable />
        </MemoryRouter>,
      );

    it("shows the relative last activity, falling back to the last login and to Nunca", () => {
      renderTable();
      const table = within(screen.getByTestId("users-desktop-table"));

      expect(table.getByText("Último acceso")).toBeInTheDocument();
      expect(table.getByText("hace 3 días")).toBeInTheDocument();
      expect(table.getByText("hace 5 minutos")).toBeInTheDocument();
      expect(table.getByText("Nunca")).toBeInTheDocument();
    });

    it("lists the four exact dates in a tooltip reachable by keyboard", async () => {
      const user = userEvent.setup();
      renderTable();
      const table = within(screen.getByTestId("users-desktop-table"));

      const trigger = table.getByText("hace 3 días");
      await user.tab();
      trigger.focus();

      const tooltip = (await screen.findAllByRole("tooltip"))[0];
      expect(tooltip).toHaveTextContent(
        `Creado: ${formatDateTime("2026-01-10T09:30:00Z")}`,
      );
      expect(tooltip).toHaveTextContent(
        `Actualizado: ${formatDateTime("2026-02-11T10:45:00Z")}`,
      );
      expect(tooltip).toHaveTextContent(
        `Último login: ${formatDateTime("2026-09-10T08:00:00Z")}`,
      );
      expect(tooltip).toHaveTextContent(
        `Última actividad: ${formatDateTime("2026-09-17T12:00:00Z")}`,
      );
      expect(tooltip.textContent).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    });

    it("shows a dash for empty dates in the tooltip", async () => {
      const user = userEvent.setup();
      renderTable();
      const table = within(screen.getByTestId("users-desktop-table"));

      await user.hover(table.getByText("Nunca"));

      const tooltip = (await screen.findAllByRole("tooltip"))[0];
      expect(tooltip).toHaveTextContent("Creado: —");
      expect(tooltip).toHaveTextContent("Actualizado: —");
      expect(tooltip).toHaveTextContent("Último login: —");
      expect(tooltip).toHaveTextContent("Última actividad: —");
    });

    it("shows the last access and the four dates in the mobile card", () => {
      renderTable();
      const cards = screen.getAllByTestId("user-mobile-card");

      expect(within(cards[0]).getByText(/hace 3 días/)).toBeInTheDocument();
      expect(
        within(cards[0]).getByText(
          `Último login: ${formatDateTime("2026-09-10T08:00:00Z")}`,
        ),
      ).toBeInTheDocument();
      expect(within(cards[2]).getByText(/Nunca/)).toBeInTheDocument();
    });

    it("sorts by last access and last login through the sort controls", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <MemoryRouter initialEntries={["/admin/users?sort=lastSeenAt:desc"]}>
          <UsersTable />
          <LocationSearch />
        </MemoryRouter>,
      );

      expect(useUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "lastSeenAt:desc" }),
      );

      await user.click(screen.getByRole("button", { name: /Filtros/i }));
      expect(screen.getByLabelText("Ordenar por")).toHaveTextContent(
        "Último acceso",
      );
      await user.click(screen.getByLabelText("Ordenar por"));
      await user.click(screen.getByRole("option", { name: "Último login" }));
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "sort=lastLoginAt%3Adesc",
      );
    });

    it("adds the last access to the export, with Nunca when there is none", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(getUsersAction).mockResolvedValue({
        items: activityUsers,
        total: 3,
        page: 1,
        size: 10000,
        pages: 1,
      } as unknown as Awaited<ReturnType<typeof getUsersAction>>);
      vi.mocked(exportToPdf).mockResolvedValue(undefined);
      renderTable();

      await user.click(screen.getByRole("button", { name: /pdf/i }));

      await waitFor(() => expect(exportToPdf).toHaveBeenCalled());
      const options = vi.mocked(exportToPdf).mock.calls[0][0];
      expect(options.columns.at(-1)).toBe("Último acceso");
      expect(options.data[0].at(-1)).toBe(
        formatDateTime("2026-09-17T12:00:00Z"),
      );
      expect(options.data[1].at(-1)).toBe(
        formatDateTime("2026-09-20T11:55:00Z"),
      );
      expect(options.data[2].at(-1)).toBe("Nunca");
    });

    it("sorts from the column header", async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <UsersTable />
          <LocationSearch />
        </MemoryRouter>,
      );
      const table = within(screen.getByTestId("users-desktop-table"));

      await user.click(table.getByRole("button", { name: /Último acceso/ }));
      await user.click(screen.getByRole("menuitem", { name: "Desc" }));
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "sort=lastSeenAt%3Adesc",
      );
    });
  });
});
