import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useCities, useCountries, useStates } from "@/admin/hooks/useLocations";
import { showConfirmDialog } from "@/store/confirm.store";
import { CitiesTable } from "../CitiesTable";
import { CountriesTable } from "../CountriesTable";
import { StatesTable } from "../StatesTable";

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: vi.fn(() => ({
    data: {
      items: [
        { id: "country-1", name: "Argentina", isActive: true },
        { id: "country-2", name: "Uruguay", isActive: false },
      ],
      total: 2,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useStates: vi.fn(() => ({
    data: {
      items: [
        {
          id: "state-1",
          name: "Mendoza",
          isActive: true,
          country: { id: "country-1", name: "Argentina", isActive: true },
        },
        {
          id: "state-2",
          name: "Canelones",
          isActive: false,
          country: { id: "country-2", name: "Uruguay", isActive: false },
        },
      ],
      total: 2,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useCities: vi.fn(() => ({
    data: {
      items: [
        {
          id: "city-1",
          name: "Godoy Cruz",
          postalCode: "5501",
          isActive: true,
          state: { id: "state-1", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
        },
        {
          id: "city-2",
          name: "Las Piedras",
          postalCode: "90200",
          isActive: false,
          state: { id: "state-2", name: "Canelones", isActive: false, country: { id: "country-2", name: "Uruguay", isActive: false } },
        },
      ],
      total: 2,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useDeleteCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteState: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateState: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/admin/actions/location.actions", () => ({
  getCountriesAction: vi.fn(),
  getStatesAction: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, pages: 1 }),
  ),
  getCitiesAction: vi.fn(),
}));

vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: vi.fn() }));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({ user: { username: "admin" } })),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("@/lib/export.utils", () => ({
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
}));

function LocationSearch() {
  const location = useLocation();
  return (
    <output data-testid="location-search">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderTable(table: React.ReactNode, entry = "/admin/locations") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      {table}
      <LocationSearch />
    </MemoryRouter>,
  );
}

describe("location table toolbars", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      "countries",
      <CountriesTable actions={<button>Nuevo País</button>} />,
      "Nuevo País",
    ],
    ["states", <StatesTable />, "Nueva Provincia"],
    ["cities", <CitiesTable />, "Nueva Ciudad"],
  ])(
    "uses the shared responsive toolbar for %s",
    (_name, table, actionLabel) => {
      renderTable(table);

      const searchRow = screen.getByTestId("list-toolbar-search");
      const actionsRow = screen.getByTestId("list-toolbar-actions");
      const searchInput = within(searchRow).getByRole("textbox");

      expect(searchInput).toHaveAttribute("data-list-toolbar-search-control");
      expect(within(searchRow).queryByText("Filtros")).not.toBeInTheDocument();
      expect(
        within(actionsRow).getByRole("button", { name: /Filtros/i }),
      ).toBeVisible();
      expect(
        within(actionsRow).getByRole("button", { name: actionLabel }),
      ).toBeVisible();
    },
  );

  it.each([
    ["countries", <CountriesTable />, "/admin/locations/countries?size=25"],
    ["states", <StatesTable />, "/admin/locations/states?size=25"],
    ["cities", <CitiesTable />, "/admin/locations/cities?size=25"],
  ])(
    "preserves URL params and clears search for %s",
    async (_name, table, entry) => {
      const user = userEvent.setup();
      renderTable(table, entry);

      const search = screen.getByPlaceholderText(
        "Buscar en todos los campos...",
      );
      await user.type(search, "sur");

      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "size=25",
      );
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "search=sur",
      );
      const clear = screen.getByRole("button", { name: "Limpiar búsqueda" });
      expect(clear).toHaveClass("size-11");

      await user.click(clear);
      expect(search).toHaveValue("");
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "size=25",
      );
      expect(screen.getByTestId("location-search")).not.toHaveTextContent(
        "search=",
      );
    },
  );

  it("preserves the state country filter", async () => {
    const user = userEvent.setup();
    renderTable(<StatesTable />);

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    await user.selectOptions(screen.getAllByRole("combobox")[1], "country-1");

    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "countryId=country-1",
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "country-1" }),
    );
  });

  it("preserves the city country/state cascade", async () => {
    const user = userEvent.setup();
    renderTable(<CitiesTable />, "/admin/locations/cities?stateId=state-1");

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(screen.getByRole("option", { name: "Argentina" }));

    const location = screen.getByTestId("location-search");
    expect(location).toHaveTextContent("countryId=country-1");
    expect(location).not.toHaveTextContent("stateId=");
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "country-1" }),
    );
    expect(vi.mocked(useCities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "country-1", stateId: undefined }),
    );
  });

  it("renders postal codes and active badges from camelCase location reads", () => {
    renderTable(<CitiesTable />);

    const cityCards = screen.getByTestId("cities-mobile-list");
    expect(within(cityCards).getByText("Código postal: 5501")).toBeVisible();
    expect(within(cityCards).getByText("Código postal: 90200")).toBeVisible();
    expect(within(cityCards).getAllByText("Activo")).toHaveLength(1);
    expect(within(cityCards).getAllByText("Inactivo")).toHaveLength(1);
  });

  it.each([
    [
      "countries",
      <CountriesTable />,
      "countries-mobile-list",
      "country-mobile-card",
      "Argentina",
      null,
      null,
    ],
    [
      "states",
      <StatesTable />,
      "states-mobile-list",
      "state-mobile-card",
      "Mendoza",
      "País: Argentina",
      null,
    ],
    [
      "cities",
      <CitiesTable />,
      "cities-mobile-list",
      "city-mobile-card",
      "Godoy Cruz",
      "Provincia: Mendoza",
      "País: Argentina",
    ],
  ])(
    "renders %s mobile cards with domain context and responsive table contract",
    (
      _name,
      table,
      listTestId,
      cardTestId,
      entityName,
      context,
      secondContext,
    ) => {
      renderTable(table);

      const list = screen.getByTestId(listTestId);
      expect(list).toHaveClass("md:hidden", "min-w-0", "flex-col");
      expect(screen.getAllByTestId(cardTestId)).toHaveLength(2);
      expect(within(list).getByText(entityName)).toBeVisible();
      if (context) expect(within(list).getByText(context)).toBeVisible();
      if (secondContext)
        expect(within(list).getByText(secondContext)).toBeVisible();
      expect(
        within(list).getAllByRole("button", { name: "Editar" })[0],
      ).toHaveClass("min-h-11");
      expect(
        within(list).getAllByLabelText(/Más acciones para/)[0],
      ).toHaveClass("size-11");
      expect(list.nextElementSibling).toHaveClass("hidden", "md:block");
    },
  );

  it("keeps country delete and restore conditions and confirmations in the card menu", async () => {
    const user = userEvent.setup();
    renderTable(<CountriesTable />);

    await user.click(screen.getByLabelText("Más acciones para Argentina"));
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(showConfirmDialog).toHaveBeenCalledWith(
      "¿Estás seguro de eliminar este país?",
      expect.any(Function),
    );

    await user.click(screen.getByLabelText("Más acciones para Uruguay"));
    expect(
      screen.queryByRole("menuitem", { name: "Eliminar" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Habilitar país" }));
    expect(showConfirmDialog).toHaveBeenLastCalledWith(
      "¿Estás seguro de habilitar este país?",
      expect.any(Function),
    );
  });

  it.each([
    [
      "states",
      <StatesTable />,
      "Más acciones para Mendoza",
      "Eliminar",
      "¿Estás seguro de eliminar esta provincia?",
    ],
    [
      "cities",
      <CitiesTable />,
      "Más acciones para Godoy Cruz",
      "Eliminar",
      "¿Estás seguro de eliminar esta ciudad?",
    ],
  ])(
    "keeps %s destructive card actions wired to existing confirmations",
    async (_name, table, menuLabel, action, confirmation) => {
      const user = userEvent.setup();
      renderTable(table);

      await user.click(screen.getByLabelText(menuLabel));
      await user.click(screen.getByRole("menuitem", { name: action }));
      expect(showConfirmDialog).toHaveBeenCalledWith(
        confirmation,
        expect.any(Function),
      );
    },
  );

  it.each([
    [
      "states",
      <StatesTable />,
      "Más acciones para Canelones",
      "Habilitar provincia",
      "¿Estás seguro de habilitar esta provincia?",
    ],
    [
      "cities",
      <CitiesTable />,
      "Más acciones para Las Piedras",
      "Habilitar ciudad",
      "¿Estás seguro de habilitar esta ciudad?",
    ],
  ])(
    "keeps %s restore conditions wired to existing confirmations",
    async (_name, table, menuLabel, action, confirmation) => {
      const user = userEvent.setup();
      renderTable(table);

      await user.click(screen.getByLabelText(menuLabel));
      expect(
        screen.queryByRole("menuitem", { name: "Eliminar" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: action }));
      expect(showConfirmDialog).toHaveBeenCalledWith(
        confirmation,
        expect.any(Function),
      );
    },
  );

  it.each([
    ["countries", <CountriesTable />, "/admin/locations/countries/edit/country-1"],
    ["states", <StatesTable />, "/admin/locations/states/edit/state-1"],
    ["cities", <CitiesTable />, "/admin/locations/cities/edit/city-1"],
  ])("keeps the visible %s card edit handler", async (_name, table, path) => {
    const user = userEvent.setup();
    renderTable(table);

    await user.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    expect(screen.getByTestId("location-search")).toHaveTextContent(path);
  });

  it.each([
    [
      "countries",
      useCountries,
      <CountriesTable />,
      "countries-mobile-list",
      "country-mobile-skeleton",
      "No hay países registrados.",
    ],
    [
      "states",
      useStates,
      <StatesTable />,
      "states-mobile-list",
      "state-mobile-skeleton",
      "No hay provincias registradas.",
    ],
    [
      "cities",
      useCities,
      <CitiesTable />,
      "cities-mobile-list",
      "city-mobile-skeleton",
      "No hay ciudades registradas.",
    ],
  ])(
    "renders mobile loading and empty equivalents for %s",
    (_name, hook, table, listTestId, skeletonTestId, emptyText) => {
      const mockedHook = vi.mocked(hook);
      mockedHook.mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        isError: false,
      } as ReturnType<typeof hook>);
      const { unmount } = renderTable(table);
      expect(
        within(screen.getByTestId(listTestId)).getAllByTestId(skeletonTestId),
      ).toHaveLength(3);
      unmount();

      mockedHook.mockReturnValueOnce({
        data: { items: [], total: 0, pages: 1 },
        isLoading: false,
        isError: false,
      } as ReturnType<typeof hook>);
      renderTable(table);
      expect(
        within(screen.getByTestId(listTestId)).getByText(emptyText),
      ).toBeVisible();
    },
  );
});
