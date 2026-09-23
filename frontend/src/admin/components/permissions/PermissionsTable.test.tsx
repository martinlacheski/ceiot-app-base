import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsTable } from "./PermissionsTable";

const permissions = [
  { value: "users.read", label: "Ver usuarios", is_basic: true },
  { value: "users.write", label: "Editar usuarios", is_basic: false },
  ...Array.from({ length: 10 }, (_, index) => ({
    value: `reports.${index + 1}`,
    label: `Reporte ${String(index + 1).padStart(2, "0")}`,
    is_basic: index % 2 === 0,
  })),
];

let hookResult: {
  data?: {
    groups: { label: string; items: typeof permissions }[];
    basic_permissions: string[];
  };
  isLoading: boolean;
  isError: boolean;
};

vi.mock("@/admin/hooks/usePermissions", () => ({
  usePermissions: () => hookResult,
}));

const { exportToExcel, exportToPdf } = vi.hoisted(() => ({
  exportToExcel: vi.fn().mockResolvedValue(undefined),
  exportToPdf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/export.utils", () => ({ exportToExcel, exportToPdf }));

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderPermissions(entry = "/admin/permissions") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PermissionsTable />
      <LocationSearch />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  exportToExcel.mockClear();
  exportToPdf.mockClear();
  hookResult = {
    data: {
      groups: [
        { label: "Usuarios", items: permissions.slice(0, 2) },
        { label: "Reportes", items: permissions.slice(2) },
      ],
      basic_permissions: ["users.read"],
    },
    isLoading: false,
    isError: false,
  };
});

describe("PermissionsTable toolbar", () => {
  it("separates the full-width search from filters without inventing an action", async () => {
    const user = userEvent.setup();
    renderPermissions();

    const searchRow = screen.getByTestId("list-toolbar-search");
    const actionsRow = screen.getByTestId("list-toolbar-actions");
    const desktopResults = screen.getByTestId("permissions-desktop-results");
    const search = within(searchRow).getByPlaceholderText(
      "Buscar en todos los campos...",
    );

    expect(searchRow).toHaveClass("w-full", "md:max-w-sm");
    expect(search).toHaveAttribute("data-list-toolbar-search-control");
    expect(within(searchRow).queryByRole("button", { name: /Filtros/i })).not.toBeInTheDocument();
    expect(within(actionsRow).getByRole("button", { name: /Filtros/i })).toBeVisible();
    expect(within(actionsRow).queryByRole("button", { name: /Nuevo/i })).not.toBeInTheDocument();
    expect(actionsRow).toHaveClass("flex-wrap", "[&_button]:min-h-11");

    await user.type(search, "Editar");
    expect(within(desktopResults).getByText("Editar usuarios")).toBeVisible();
    expect(within(desktopResults).queryByText("Ver usuarios")).not.toBeInTheDocument();

    const clear = screen.getByRole("button", { name: "Limpiar búsqueda" });
    expect(clear).toHaveClass("size-11");
    await user.click(clear);
    expect(search).toHaveValue("");
    expect(within(desktopResults).getByText("Ver usuarios")).toBeVisible();
  });
});

describe("PermissionsTable responsive results", () => {
  it("renders titled read-only permission articles with the required fields", () => {
    renderPermissions();

    const mobileResults = screen.getByRole("list", {
      name: "Permisos",
    });
    const cards = within(mobileResults).getAllByRole("article");

    expect(mobileResults).toHaveClass("md:hidden");
    expect(cards).toHaveLength(10);

    const basicCard = cards[0];
    const basicTitle = within(basicCard).getByRole("heading", {
      name: "Ver usuarios",
    });
    expect(basicCard).toHaveAttribute("aria-labelledby", basicTitle.id);
    expect(within(basicCard).getByText("Permiso:")).toBeVisible();
    expect(within(basicCard).getByText("Tipo:")).toBeVisible();
    expect(within(basicCard).getByText("Código:")).toBeVisible();
    expect(within(basicCard).getByText("Grupo:")).toBeVisible();
    expect(within(basicCard).getByText("users.read").tagName).toBe("CODE");
    expect(within(basicCard).getByText("Usuarios")).toHaveAttribute(
      "data-slot",
      "badge"
    );
    expect(within(basicCard).getByText("Básico")).toHaveAttribute(
      "data-slot",
      "badge"
    );

    const optionalCard = cards[1];
    expect(
      within(optionalCard).getByRole("heading", { name: "Editar usuarios" })
    ).toBeVisible();
    expect(within(optionalCard).getByText("users.write").tagName).toBe("CODE");
    expect(within(optionalCard).getByText("Opcional")).toHaveAttribute(
      "data-slot",
      "badge"
    );

    for (const card of cards) {
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    }
    expect(screen.getByTestId("list-export-actions")).toHaveClass("justify-end");
  });

  it("shows the same ordered permissions in mobile cards and desktop rows", () => {
    renderPermissions();

    const mobileResults = screen.getByRole("list", { name: "Permisos" });
    const desktopResults = screen.getByTestId("permissions-desktop-results");
    const cardLabels = within(mobileResults)
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    const rowLabels = within(desktopResults)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);

    expect(desktopResults).toHaveClass("hidden", "md:block");
    expect(cardLabels).toEqual([
      "Ver usuarios",
      "Editar usuarios",
      ...Array.from({ length: 8 }, (_, index) =>
        `Reporte ${String(index + 1).padStart(2, "0")}`
      ),
    ]);
    expect(rowLabels).toEqual(cardLabels);
  });

  it("shares search, filters, clearing, sorting, and pagination", async () => {
    const user = userEvent.setup();
    renderPermissions();
    const cards = () => within(screen.getByRole("list", { name: "Permisos" }));
    const rows = () => within(screen.getByTestId("permissions-desktop-results"));

    await user.type(
      screen.getByPlaceholderText("Buscar en todos los campos..."),
      "Editar",
    );
    expect(cards().getAllByRole("heading").map((item) => item.textContent)).toEqual(["Editar usuarios"]);
    expect(rows().getAllByRole("row")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    const filters = screen.getAllByRole("combobox");
    await user.selectOptions(filters[0], "Reportes");
    await user.selectOptions(filters[1], "optional");
    expect(cards().getAllByRole("heading").map((item) => item.textContent)).toEqual([
      "Reporte 02", "Reporte 04", "Reporte 06", "Reporte 08", "Reporte 10",
    ]);
    await user.click(screen.getByRole("button", { name: "Limpiar todos" }));
    expect(cards().getAllByRole("heading")).toHaveLength(10);

    await user.click(rows().getByRole("button", { name: /Permiso/i }));
    await user.click(screen.getByRole("menuitem", { name: "Asc" }));
    expect(cards().getAllByRole("heading")[0]).toHaveTextContent("Editar usuarios");
    expect(rows().getAllByRole("row")[1]).toHaveTextContent("Editar usuarios");
    await user.click(screen.getByRole("button", { name: "Ir a la página siguiente" }));
    expect(cards().getAllByRole("heading").map((item) => item.textContent)).toEqual([
      "Reporte 10", "Ver usuarios",
    ]);
    expect(rows().getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Ver usuarios"), expect.stringContaining("Reporte 10")])
    );
    screen.getAllByRole("combobox").at(-1)!.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(cards().getAllByRole("heading")).toHaveLength(12);
    expect(screen.getByText("Página 1 de 1")).toBeVisible();
  });

  it("preserves loading, empty, and error short-circuit states", () => {
    hookResult = { data: undefined, isLoading: true, isError: false };
    const { rerender } = renderPermissions();
    expect(screen.getAllByText("Cargando...")).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "Permisos" })).not.toBeInTheDocument();

    hookResult = { data: { groups: [], basic_permissions: [] }, isLoading: false, isError: false };
    rerender(
      <MemoryRouter>
        <PermissionsTable />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("No hay resultados.")).toHaveLength(2);

    hookResult = { data: undefined, isLoading: false, isError: true };
    rerender(
      <MemoryRouter>
        <PermissionsTable />
      </MemoryRouter>,
    );
    expect(screen.getByText("Error al cargar permisos")).toBeVisible();
    expect(
      screen.queryByPlaceholderText("Buscar en todos los campos..."),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("permissions-desktop-results")).not.toBeInTheDocument();
    expect(screen.queryByText(/Página 1 de/)).not.toBeInTheDocument();
  });

  it("searches the visible Tipo label instead of the raw boolean", async () => {
    const user = userEvent.setup();
    renderPermissions();

    await user.type(
      screen.getByPlaceholderText("Buscar en todos los campos..."),
      "Opcional",
    );

    const cards = within(screen.getByRole("list", { name: "Permisos" }));
    expect(cards.getAllByRole("heading").map((item) => item.textContent)).toEqual([
      "Editar usuarios",
      "Reporte 02",
      "Reporte 04",
      "Reporte 06",
      "Reporte 08",
      "Reporte 10",
    ]);
  });

  it("hydrates validated page, size, search, filters and sort from the URL", async () => {
    renderPermissions(
      "/admin/permissions?page=2&size=5&search=Reporte&group=Reportes&type=optional&sort=label:desc",
    );

    expect(screen.getByPlaceholderText("Buscar en todos los campos...")).toHaveValue(
      "Reporte",
    );
    expect(screen.getByText("Página 1 de 1")).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Permisos" }))
        .getAllByRole("heading")
        .map((item) => item.textContent),
    ).toEqual(["Reporte 10", "Reporte 08", "Reporte 06", "Reporte 04", "Reporte 02"]);
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("page=1"),
    );
  });

  it("persists interactions in the URL and normalizes invalid values", async () => {
    const user = userEvent.setup();
    renderPermissions(
      "/admin/permissions?page=abc&size=0&type=wrong&sort=missing:sideways",
    );

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).not.toContain("page=abc");
      expect(screen.getByTestId("location-search").textContent).not.toContain("size=0");
      expect(screen.getByTestId("location-search").textContent).not.toContain("type=wrong");
      expect(screen.getByTestId("location-search").textContent).not.toContain("sort=");
    });

    await user.type(
      screen.getByPlaceholderText("Buscar en todos los campos..."),
      "Editar",
    );
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("search=Editar"),
    );

    await user.click(screen.getByRole("button", { name: /Filtros/i }));
    await user.selectOptions(screen.getAllByRole("combobox")[1], "optional");
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("type=optional"),
    );
  });

  it("clamps an out-of-range URL page after rows load", async () => {
    renderPermissions("/admin/permissions?page=99&size=10");

    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent("page=2"),
    );
    expect(screen.getByText("Página 2 de 2")).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Permisos" })).getAllByRole("heading"),
    ).toHaveLength(2);
  });

  it("exports every matching row in the active sort, not only the current page", async () => {
    const user = userEvent.setup();
    renderPermissions("/admin/permissions?search=Reporte&sort=label:desc&size=5");

    await user.click(screen.getByRole("button", { name: "Excel" }));

    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(exportToExcel).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          ["Reporte 10", "reports.10", "Reportes", "Opcional"],
          ["Reporte 09", "reports.9", "Reportes", "Básico"],
          ["Reporte 08", "reports.8", "Reportes", "Opcional"],
          ["Reporte 07", "reports.7", "Reportes", "Básico"],
          ["Reporte 06", "reports.6", "Reportes", "Opcional"],
          ["Reporte 05", "reports.5", "Reportes", "Básico"],
          ["Reporte 04", "reports.4", "Reportes", "Opcional"],
          ["Reporte 03", "reports.3", "Reportes", "Básico"],
          ["Reporte 02", "reports.2", "Reportes", "Opcional"],
          ["Reporte 01", "reports.1", "Reportes", "Básico"],
        ],
      }),
    );
  });
});
