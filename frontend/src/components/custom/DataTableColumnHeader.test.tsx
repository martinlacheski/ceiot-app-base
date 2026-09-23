import { render, screen } from "@testing-library/react";
import type { Column } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";

import { DataTableColumnHeader } from "./DataTableColumnHeader";

const makeColumn = (canSort: boolean) =>
  ({
    getCanSort: () => canSort,
    getIsSorted: () => false,
    toggleSorting: vi.fn(),
    clearSorting: vi.fn(),
  }) as unknown as Column<unknown, unknown>;

describe("DataTableColumnHeader alignment", () => {
  it("keeps the start alignment by default", () => {
    render(<DataTableColumnHeader column={makeColumn(true)} title="Estado" />);
    const wrapper = screen.getByRole("button", { name: "Estado" }).parentElement!;
    expect(wrapper).toHaveClass("justify-start");
    expect(screen.getByRole("button", { name: "Estado" })).toHaveClass("-ml-3");
  });

  it("centers a sortable header, sort icon next to the label", () => {
    render(<DataTableColumnHeader column={makeColumn(true)} title="Estado" align="center" />);
    const button = screen.getByRole("button", { name: "Estado" });
    expect(button.parentElement).toHaveClass("justify-center", "w-full");
    expect(button).not.toHaveClass("-ml-3");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("centers a non-sortable header as plain text", () => {
    render(<DataTableColumnHeader column={makeColumn(false)} title="Acciones" align="center" />);
    expect(screen.getByText("Acciones")).toHaveClass("text-center");
  });

  it("keeps the end alignment", () => {
    render(<DataTableColumnHeader column={makeColumn(false)} title="Monto" align="end" />);
    expect(screen.getByText("Monto")).toHaveClass("text-right");
  });
});
