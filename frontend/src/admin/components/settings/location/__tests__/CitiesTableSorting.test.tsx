import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getCitiesAction } from "@/admin/actions/location.actions";
import { useCities, useStates } from "@/admin/hooks/useLocations";
import { CitiesTable } from "../CitiesTable";
import {
  CITY_SORT_OPTIONS,
  parseLocationSort,
  serializeLocationSort,
} from "../locationSort";

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: vi.fn(() => ({
    data: { items: [{ id: "country-1", name: "Argentina" }] },
  })),
  useStates: vi.fn(() => ({
    data: { items: [{ id: "url-state", name: "Mendoza" }] },
  })),
  useCities: vi.fn(() => ({
    data: {
      items: [
        {
          id: "city-1",
          name: "Godoy Cruz",
          postalCode: "5501",
          isActive: true,
          state: {
            id: "url-state",
            name: "Mendoza",
            isActive: true,
            country: { id: "country-1", name: "Argentina", isActive: true },
          },
        },
      ],
      total: 1,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useDeleteCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCity: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/admin/actions/location.actions", () => ({
  getCitiesAction: vi.fn(() =>
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

function renderCities(entry: string, stateId?: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CitiesTable stateId={stateId} />
      <LocationSearch />
    </MemoryRouter>,
  );
}

describe("CitiesTable sorting", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["name", "asc"],
    ["name", "desc"],
    ["stateName", "asc"],
    ["stateName", "desc"],
    ["countryName", "asc"],
    ["countryName", "desc"],
    ["postalCode", "asc"],
    ["postalCode", "desc"],
    ["isActive", "asc"],
    ["isActive", "desc"],
  ] as const)("accepts the canonical city sort %s:%s", (field, direction) => {
    const parsed = parseLocationSort(`${field}:${direction}`, CITY_SORT_OPTIONS);

    expect(parsed).toEqual({ sort: { field, direction }, isValid: true });
    expect(serializeLocationSort(parsed.sort)).toBe(`${field}:${direction}`);
  });

  it("suppresses invalid sorting and normalizes without losing filters or size", async () => {
    renderCities(
      "/cities?sort=name:asc,stateName:desc&search=sur&countryId=country-1&stateId=url-state&size=25&page=4",
    );

    expect(vi.mocked(useCities)).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: undefined,
        search: "sur",
        countryId: "country-1",
        stateId: "url-state",
        size: 25,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(
        "search=sur&countryId=country-1&stateId=url-state&size=25&page=1",
      ),
    );
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
  });

  it("synchronizes controls, query, export, badge and clear with prop context", async () => {
    const user = userEvent.setup();
    renderCities(
      "/cities?countryId=country-1&stateId=url-state&search=sur&size=25&page=3",
      "prop-state",
    );
    await user.click(screen.getByRole("button", { name: /Filtros/i }));

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "Provincia" }));
    await user.click(screen.getByLabelText("Dirección"));
    await user.click(screen.getByRole("option", { name: "Descendente" }));

    expect(screen.getByTestId("search")).toHaveTextContent(
      "countryId=country-1&stateId=url-state&search=sur&size=25&page=1&sort=stateName%3Adesc",
    );
    expect(vi.mocked(useCities)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        countryId: undefined,
        stateId: "prop-state",
        sort: "stateName:desc",
      }),
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: undefined }),
    );
    expect(screen.getByRole("button", { name: /Filtros!/i })).toBeVisible();
    expect(screen.getByLabelText("Ordenar por")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Dirección")).toHaveClass("min-h-11");

    await user.click(screen.getByRole("button", { name: /Excel/i }));
    await waitFor(() =>
      expect(vi.mocked(getCitiesAction)).toHaveBeenCalledWith(
        expect.objectContaining({
          countryId: undefined,
          stateId: "prop-state",
          sort: "stateName:desc",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));
    expect(screen.getByTestId("search")).toHaveTextContent("size=25&page=1");
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
    expect(within(screen.getByTestId("cities-mobile-list")).getByText("Godoy Cruz")).toBeVisible();
    expect(screen.getByLabelText("Más acciones para Godoy Cruz")).toBeVisible();
  });

  it("keeps conjunctive URL hierarchy filters when no state prop is supplied", () => {
    renderCities(
      "/cities?countryId=country-1&stateId=url-state&sort=countryName:asc",
    );

    expect(vi.mocked(useCities)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        countryId: "country-1",
        stateId: "url-state",
        sort: "countryName:asc",
      }),
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "country-1" }),
    );
  });

  it("keeps headers single-sort and preserves the country to state cascade", async () => {
    const user = userEvent.setup();
    renderCities("/cities?sort=isActive:desc&stateId=url-state&size=25");
    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Estado");
    expect(screen.getByLabelText("Dirección")).toHaveTextContent("Descendente");

    const postalHeader = screen.getByRole("button", { name: /Código Postal/i });
    expect(postalHeader).toHaveClass("min-h-11");
    await user.click(postalHeader);
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=postalCode%3Aasc&stateId=url-state&size=25&page=1",
    );

    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(screen.getByRole("option", { name: "Argentina" }));
    expect(screen.getByTestId("search")).not.toHaveTextContent("stateId=");
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "country-1" }),
    );
    expect(screen.queryByText(/Shift/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/múltiples columnas/i)).not.toBeInTheDocument();
  });

  it("keeps the Filtros trigger at the 44px touch-target minimum", () => {
    renderCities("/cities");
    expect(screen.getByRole("button", { name: /Filtros/i })).toHaveClass(
      "min-h-11",
    );
  });

  const defaultCitiesResult = {
    data: {
      items: [
        {
          id: "city-1",
          name: "Godoy Cruz",
          postalCode: "5501",
          isActive: true,
          state: {
            id: "url-state",
            name: "Mendoza",
            isActive: true,
            country: { id: "country-1", name: "Argentina", isActive: true },
          },
        },
      ],
      total: 1,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useCities>;

  it.each([
    ["ascending", "name:asc", ["Godoy Cruz", "Rosario"]],
    ["descending", "name:desc", ["Rosario", "Godoy Cruz"]],
  ] as const)(
    "renders card and table order matching an %s hydrated sort",
    async (_label, sort, expectedOrder) => {
      vi.mocked(useCities).mockImplementation(
        (args: { sort?: string }) =>
          ({
            data: {
              items:
                args?.sort === "name:desc"
                  ? [
                      {
                        id: "city-2",
                        name: "Rosario",
                        postalCode: "2000",
                        isActive: true,
                        state: { id: "url-state", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
                      },
                      {
                        id: "city-1",
                        name: "Godoy Cruz",
                        postalCode: "5501",
                        isActive: true,
                        state: { id: "url-state", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
                      },
                    ]
                  : [
                      {
                        id: "city-1",
                        name: "Godoy Cruz",
                        postalCode: "5501",
                        isActive: true,
                        state: { id: "url-state", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
                      },
                      {
                        id: "city-2",
                        name: "Rosario",
                        postalCode: "2000",
                        isActive: true,
                        state: { id: "url-state", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
                      },
                    ],
              total: 2,
              pages: 1,
            },
            isLoading: false,
            isError: false,
          }) as ReturnType<typeof useCities>,
      );

      renderCities(`/cities?sort=${sort}&size=25`);

      const cards = within(
        screen.getByTestId("cities-mobile-list"),
      ).getAllByTestId("city-mobile-card");
      expect(cards[0]).toHaveTextContent(expectedOrder[0]);
      expect(cards[1]).toHaveTextContent(expectedOrder[1]);

      const rows = within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1);
      expect(rows[0]).toHaveTextContent(expectedOrder[0]);
      expect(rows[1]).toHaveTextContent(expectedOrder[1]);

      vi.mocked(useCities).mockReturnValue(defaultCitiesResult);
    },
  );

  it("retains the active sort across page and page-size changes", async () => {
    const user = userEvent.setup();
    vi.mocked(useCities).mockReturnValue({
      data: {
        items: [
          {
            id: "city-1",
            name: "Godoy Cruz",
            postalCode: "5501",
            isActive: true,
            state: { id: "url-state", name: "Mendoza", isActive: true, country: { id: "country-1", name: "Argentina", isActive: true } },
          },
        ],
        total: 30,
        pages: 3,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCities>);

    renderCities("/cities?sort=postalCode:desc&size=10&page=1");
    expect(vi.mocked(useCities)).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "postalCode:desc" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=postalCode%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("page=2");
    expect(vi.mocked(useCities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "postalCode:desc", page: 2 }),
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "20" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=postalCode%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("size=20");
    expect(vi.mocked(useCities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "postalCode:desc", size: 20 }),
    );

    vi.mocked(useCities).mockReturnValue(defaultCitiesResult);
  });
});
