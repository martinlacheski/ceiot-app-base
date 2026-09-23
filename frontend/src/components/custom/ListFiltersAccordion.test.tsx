import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useListFilters } from "@/hooks/useListFilters";

import { ListFiltersPanel, ListFiltersTrigger } from "./ListFiltersAccordion";

function Harness({ active = false, onReset = vi.fn() }: { active?: boolean; onReset?: () => void }) {
  const filters = useListFilters();
  return (
    <>
      <ListFiltersTrigger open={filters.open} onOpenChange={filters.setOpen} hasActiveFilters={active} />
      <ListFiltersPanel
        open={filters.open}
        onOpenChange={filters.setOpen}
        hasActiveFilters={active}
        onReset={onReset}
        className="lg:grid-cols-4"
      >
        <label>
          Campo de prueba
          <input />
        </label>
      </ListFiltersPanel>
    </>
  );
}

describe("ListFilters", () => {
  it("toggles the panel from the Filtros button", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Filtros/ });
    await userEvent.click(trigger);
    expect(screen.getByText("Filtros avanzados")).toBeVisible();
    expect(screen.getByLabelText("Campo de prueba")).toBeVisible();
    await userEvent.click(trigger);
    expect(screen.queryByLabelText("Campo de prueba")).not.toBeInTheDocument();
  });

  it("shows the active indicator only when filters are active", () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByText("!")).not.toBeInTheDocument();
    rerender(<Harness active />);
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("offers the reset only with active filters and calls onReset", async () => {
    const onReset = vi.fn();
    const { rerender } = render(<Harness onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    expect(screen.queryByRole("button", { name: "Limpiar todos" })).not.toBeInTheDocument();
    rerender(<Harness active onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Limpiar todos" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("passes the grid classes to the fields container", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    expect(screen.getByTestId("list-filters-fields")).toHaveClass("grid", "lg:grid-cols-4");
  });
});
