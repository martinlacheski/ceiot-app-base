import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getStatesAction } from "@/admin/actions/location.actions";
import { useStates } from "@/admin/hooks/useLocations";
import { StatesTable } from "../StatesTable";
import {
  parseLocationSort,
  serializeLocationSort,
  STATE_SORT_OPTIONS,
} from "../locationSort";

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: vi.fn(() => ({
    data: { items: [{ id: "url-country", name: "Uruguay" }] },
  })),
  useStates: vi.fn(() => ({
    data: {
      items: [
        {
          id: "state-1",
          name: "Mendoza",
          is_active: true,
          country: { id: "prop-country", name: "Argentina" },
        },
      ],
      total: 1,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  })),
  useDeleteState: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateState: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/admin/actions/location.actions", () => ({
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

function renderStates(entry: string, countryId?: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StatesTable countryId={countryId} />
      <LocationSearch />
    </MemoryRouter>,
  );
}

describe("StatesTable sorting", () => {
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
    ["countryName", "asc"],
    ["countryName", "desc"],
    ["isActive", "asc"],
    ["isActive", "desc"],
  ] as const)("accepts the canonical state sort %s:%s", (field, direction) => {
    const parsed = parseLocationSort(`${field}:${direction}`, STATE_SORT_OPTIONS);

    expect(parsed).toEqual({ sort: { field, direction }, isValid: true });
    expect(serializeLocationSort(parsed.sort)).toBe(`${field}:${direction}`);
  });

  it("suppresses invalid sorting and normalizes the URL without losing filters or size", async () => {
    renderStates(
      "/states?sort=name:asc,countryName:desc&search=sur&countryId=url-country&size=25&page=4",
    );

    expect(vi.mocked(useStates)).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: undefined,
        search: "sur",
        countryId: "url-country",
        size: 25,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(
        "search=sur&countryId=url-country&size=25&page=1",
      ),
    );
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
  });

  it("synchronizes controls, query, export, badge and clear-all with prop context", async () => {
    const user = userEvent.setup();
    renderStates(
      "/states?countryId=url-country&search=sur&size=25&page=3",
      "prop-country",
    );
    await user.click(screen.getByRole("button", { name: /Filtros/i }));

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "País" }));
    await user.click(screen.getByLabelText("Dirección"));
    await user.click(screen.getByRole("option", { name: "Descendente" }));

    expect(screen.getByTestId("search")).toHaveTextContent(
      "countryId=url-country&search=sur&size=25&page=1&sort=countryName%3Adesc",
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "prop-country", sort: "countryName:desc" }),
    );
    expect(screen.getByRole("button", { name: /Filtros!/i })).toBeVisible();
    expect(screen.getByLabelText("Ordenar por")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Dirección")).toHaveClass("min-h-11");

    await user.click(screen.getByRole("button", { name: /Excel/i }));
    await waitFor(() =>
      expect(vi.mocked(getStatesAction)).toHaveBeenCalledWith(
        expect.objectContaining({ countryId: "prop-country", sort: "countryName:desc" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));
    expect(screen.getByTestId("search")).toHaveTextContent("size=25&page=1");
    expect(screen.getByTestId("search")).not.toHaveTextContent("countryId=");
    expect(screen.getByTestId("search")).not.toHaveTextContent("sort=");
    expect(within(screen.getByTestId("states-mobile-list")).getByText("Mendoza")).toBeVisible();
    expect(screen.getByLabelText("Más acciones para Mendoza")).toBeVisible();
  });

  it("keeps desktop headers, controls, URL and query on one canonical sort", async () => {
    const user = userEvent.setup();
    renderStates("/states?sort=isActive:desc&size=25");
    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Estado");
    expect(screen.getByLabelText("Dirección")).toHaveTextContent("Descendente");

    const countryHeader = screen.getByRole("button", { name: /País/i });
    expect(countryHeader).toHaveClass("min-h-11");
    await user.click(countryHeader);
    expect(screen.queryByRole("menuitem", { name: "Reset" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=countryName%3Aasc&size=25&page=1",
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "countryName:asc" }),
    );
  });

  it("does not advertise multi-column sorting", () => {
    renderStates("/states");

    expect(screen.queryByText(/Shift/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/múltiples columnas/i)).not.toBeInTheDocument();
  });

  it("keeps Shift-assisted header sorting single-column", async () => {
    const user = userEvent.setup();
    renderStates("/states?sort=name:asc&size=25");

    await user.click(screen.getByRole("button", { name: /País/i }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("menuitem", { name: "Desc" }));
    await user.keyboard("{/Shift}");

    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=countryName%3Adesc&size=25&page=1",
    );
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "countryName:desc" }),
    );
  });

  it("keeps the Filtros trigger at the 44px touch-target minimum", () => {
    renderStates("/states");
    expect(screen.getByRole("button", { name: /Filtros/i })).toHaveClass(
      "min-h-11",
    );
  });

  const defaultStatesResult = {
    data: {
      items: [
        {
          id: "state-1",
          name: "Mendoza",
          is_active: true,
          country: { id: "prop-country", name: "Argentina" },
        },
      ],
      total: 1,
      pages: 1,
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useStates>;

  it.each([
    [
      "ascending",
      "name:asc",
      ["Mendoza", "Salta"],
    ],
    [
      "descending",
      "name:desc",
      ["Salta", "Mendoza"],
    ],
  ] as const)(
    "renders card and table order matching an %s hydrated sort",
    async (_label, sort, expectedOrder) => {
      vi.mocked(useStates).mockImplementation(
        (args: { sort?: string }) =>
          ({
            data: {
              items:
                args?.sort === "name:desc"
                  ? [
                      {
                        id: "state-2",
                        name: "Salta",
                        is_active: true,
                        country: { id: "prop-country", name: "Argentina" },
                      },
                      {
                        id: "state-1",
                        name: "Mendoza",
                        is_active: true,
                        country: { id: "prop-country", name: "Argentina" },
                      },
                    ]
                  : [
                      {
                        id: "state-1",
                        name: "Mendoza",
                        is_active: true,
                        country: { id: "prop-country", name: "Argentina" },
                      },
                      {
                        id: "state-2",
                        name: "Salta",
                        is_active: true,
                        country: { id: "prop-country", name: "Argentina" },
                      },
                    ],
              total: 2,
              pages: 1,
            },
            isLoading: false,
            isError: false,
          }) as ReturnType<typeof useStates>,
      );

      renderStates(`/states?sort=${sort}&size=25`);

      const cards = within(
        screen.getByTestId("states-mobile-list"),
      ).getAllByTestId("state-mobile-card");
      expect(cards[0]).toHaveTextContent(expectedOrder[0]);
      expect(cards[1]).toHaveTextContent(expectedOrder[1]);

      const rows = within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1);
      expect(rows[0]).toHaveTextContent(expectedOrder[0]);
      expect(rows[1]).toHaveTextContent(expectedOrder[1]);

      vi.mocked(useStates).mockReturnValue(defaultStatesResult);
    },
  );

  it("retains the active sort across page and page-size changes", async () => {
    const user = userEvent.setup();
    vi.mocked(useStates).mockReturnValue({
      data: {
        items: [
          {
            id: "state-1",
            name: "Mendoza",
            is_active: true,
            country: { id: "prop-country", name: "Argentina" },
          },
        ],
        total: 30,
        pages: 3,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useStates>);

    renderStates("/states?sort=countryName:desc&size=10&page=1");
    expect(vi.mocked(useStates)).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "countryName:desc" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=countryName%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("page=2");
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "countryName:desc", page: 2 }),
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "20" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "sort=countryName%3Adesc",
    );
    expect(screen.getByTestId("search")).toHaveTextContent("size=20");
    expect(vi.mocked(useStates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "countryName:desc", size: 20 }),
    );

    vi.mocked(useStates).mockReturnValue(defaultStatesResult);
  });
});
