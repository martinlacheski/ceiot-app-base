import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CatalogListPage } from "./CatalogListPage";
import { catalogApi } from "./catalogApi";

vi.mock("./catalogApi", () => ({ catalogApi: { list: vi.fn(), deactivate: vi.fn(), update: vi.fn() } }));
vi.mock("@/auth/store/auth.store", () => ({ useAuthStore: (selector: (state: object) => unknown) => selector({ user: { isAdmin: true, permissions: ["sensor_catalog:write"] } }) }));

function renderList(kind: "sensors" | "variables") {
  vi.mocked(catalogApi.list).mockResolvedValue({ items: [{ id: "s1", code: "dht", name: "DHT", manufacturer: "Acme", variables: [], unit: "°C", isActive: true }], total: 1, page: 1, perPage: 10, pages: 1 } as never);
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CatalogListPage kind={kind} /></MemoryRouter></QueryClientProvider>);
}

describe("catalog lists", () => {
  it("uses specific create labels, icon actions and sensor filters", async () => {
    renderList("sensors");
    expect(screen.getByRole("link", { name: "Nuevo sensor" })).toHaveClass("h-11");
    await waitFor(() => expect(screen.getByRole("link", { name: "Editar sensor" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Desactivar sensor" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByLabelText("Fabricante")).toBeInTheDocument();
    expect(screen.getByLabelText("Mide la variable")).toBeInTheDocument();
  });

  it("uses the variable-specific filter and create label", async () => {
    renderList("variables");
    expect(screen.getByRole("link", { name: "Nueva variable" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByLabelText("Unidad")).toBeInTheDocument();
  });
});
