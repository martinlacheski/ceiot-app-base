import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getCountriesAction } from "@/admin/actions/location.actions";
import { useCountries } from "@/admin/hooks/useLocations";
import { CountriesTable } from "../CountriesTable";

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: vi.fn(() => ({
    data: {
      items: [{ id: "ar", name: "Argentina", is_active: true }],
      total: 1,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useDeleteCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCountry: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/admin/actions/location.actions", () => ({
  getCountriesAction: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, pages: 1 }),
  ),
  getStatesAction: vi.fn(() =>
    Promise.resolve({ items: [], total: 0, pages: 1 }),
  ),
}));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({ user: { username: "admin" } })),
}));
vi.mock("@/lib/export.utils", () => ({
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}));

function LocationSearch() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderCountries(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CountriesTable />
      <LocationSearch />
    </MemoryRouter>,
  );
}

describe("CountriesTable sorting", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  beforeEach(() => vi.clearAllMocks());

  it("suppresses and normalizes invalid sorting while preserving filters and size", async () => {
    renderCountries("/countries?sort=name:asc,isActive:desc&search=sur&size=25&page=4");

    expect(vi.mocked(useCountries)).toHaveBeenCalledWith(
      expect.objectContaining({ sort: undefined, search: "sur", size: 25 }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(
        "search=sur&size=25&page=1",
      ),
    );
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
  });

  it("synchronizes advanced controls, query, export, badge and clear-all", async () => {
    const user = userEvent.setup();
    renderCountries("/countries?size=25&page=3");
    await user.click(screen.getByRole("button", { name: /Filtros/i }));

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "Estado" }));
    await user.click(screen.getByLabelText("Dirección"));
    await user.click(screen.getByRole("option", { name: "Descendente" }));

    expect(screen.getByTestId("search")).toHaveTextContent(
      "size=25&page=1&sort=isActive%3Adesc",
    );
    expect(vi.mocked(useCountries)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "isActive:desc" }),
    );
    expect(screen.getByRole("button", { name: /Filtros!/i })).toBeVisible();
    expect(screen.queryByText(/múltiples columnas/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ordenar por")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Dirección")).toHaveClass("min-h-11");

    await user.click(screen.getByRole("button", { name: /Excel/i }));
    await waitFor(() =>
      expect(vi.mocked(getCountriesAction)).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "isActive:desc" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));
    expect(screen.getByTestId("search")).toHaveTextContent("size=25&page=1");
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
    expect(screen.getByRole("button", { name: "Filtros" })).toBeVisible();
    expect(within(screen.getByTestId("countries-mobile-list")).getByText("Argentina")).toBeVisible();
  });

  it("keeps header sorting, controls, URL and pagination on one canonical value", async () => {
    const user = userEvent.setup();
    renderCountries("/countries?sort=name:desc&size=25");
    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Nombre");
    expect(screen.getByLabelText("Dirección")).toHaveTextContent("Descendente");

    const nameHeaderTrigger = screen.getByRole("button", { name: /Nombre/i });
    expect(nameHeaderTrigger).toHaveClass("min-h-11");
    await user.click(nameHeaderTrigger);
    expect(screen.queryByRole("menuitem", { name: "Reset" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=name%3Aasc&size=25&page=1",
    );
    expect(vi.mocked(useCountries)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "name:asc" }),
    );
  });

  it("keeps the Filtros trigger at the 44px touch-target minimum", () => {
    renderCountries("/countries");
    expect(screen.getByRole("button", { name: /Filtros/i })).toHaveClass(
      "min-h-11",
    );
  });

  it("renders card and table order matching an ascending hydrated sort", async () => {
    vi.mocked(useCountries).mockImplementation(
      (args: { sort?: string }) =>
        ({
          data: {
            items:
              args?.sort === "name:desc"
                ? [
                    { id: "br", name: "Brasil", is_active: true },
                    { id: "ar", name: "Argentina", is_active: true },
                  ]
                : [
                    { id: "ar", name: "Argentina", is_active: true },
                    { id: "br", name: "Brasil", is_active: true },
                  ],
            total: 2,
            pages: 1,
          },
          isLoading: false,
          isError: false,
        }) as ReturnType<typeof useCountries>,
    );

    renderCountries("/countries?sort=name:asc&size=25");

    const cards = within(
      screen.getByTestId("countries-mobile-list"),
    ).getAllByTestId("country-mobile-card");
    expect(cards[0]).toHaveTextContent("Argentina");
    expect(cards[1]).toHaveTextContent("Brasil");

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Argentina");
    expect(rows[1]).toHaveTextContent("Brasil");

    vi.mocked(useCountries).mockReturnValue({
      data: {
        items: [{ id: "ar", name: "Argentina", is_active: true }],
        total: 1,
        pages: 1,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCountries>);
  });

  it("renders card and table order matching a descending hydrated sort", async () => {
    vi.mocked(useCountries).mockImplementation(
      (args: { sort?: string }) =>
        ({
          data: {
            items:
              args?.sort === "name:desc"
                ? [
                    { id: "br", name: "Brasil", is_active: true },
                    { id: "ar", name: "Argentina", is_active: true },
                  ]
                : [
                    { id: "ar", name: "Argentina", is_active: true },
                    { id: "br", name: "Brasil", is_active: true },
                  ],
            total: 2,
            pages: 1,
          },
          isLoading: false,
          isError: false,
        }) as ReturnType<typeof useCountries>,
    );

    renderCountries("/countries?sort=name:desc&size=25");

    const cards = within(
      screen.getByTestId("countries-mobile-list"),
    ).getAllByTestId("country-mobile-card");
    expect(cards[0]).toHaveTextContent("Brasil");
    expect(cards[1]).toHaveTextContent("Argentina");

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Brasil");
    expect(rows[1]).toHaveTextContent("Argentina");

    vi.mocked(useCountries).mockReturnValue({
      data: {
        items: [{ id: "ar", name: "Argentina", is_active: true }],
        total: 1,
        pages: 1,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCountries>);
  });

  it("retains the active sort across page and page-size changes", async () => {
    const user = userEvent.setup();
    vi.mocked(useCountries).mockReturnValue({
      data: {
        items: [{ id: "ar", name: "Argentina", is_active: true }],
        total: 30,
        pages: 3,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCountries>);

    renderCountries("/countries?sort=name:desc&size=10&page=1");
    expect(vi.mocked(useCountries)).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "name:desc" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=name%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("page=2");
    expect(vi.mocked(useCountries)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "name:desc", page: 2 }),
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "20" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=name%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("size=20");
    expect(vi.mocked(useCountries)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "name:desc", size: 20 }),
    );

    vi.mocked(useCountries).mockReturnValue({
      data: {
        items: [{ id: "ar", name: "Argentina", is_active: true }],
        total: 1,
        pages: 1,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCountries>);
  });
});
