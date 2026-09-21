import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ListToolbarLayout } from "../ListToolbarLayout";

describe("ListToolbarLayout", () => {
  it("separates search from wrapping primary and secondary actions", () => {
    render(
      <ListToolbarLayout
        search={
          <div>
            <Input aria-label="Buscar" data-list-toolbar-search-control />
            <button type="button">Ayuda</button>
          </div>
        }
        primaryActions={
          <>
            <Button>Filtros</Button>
            <Button className="max-w-full whitespace-normal">
              Nueva Condición Fiscal
            </Button>
          </>
        }
        secondaryActions={<Button>Resetear</Button>}
      />,
    );

    const toolbar = screen.getByTestId("list-toolbar");
    const search = screen.getByTestId("list-toolbar-search");
    const actions = screen.getByTestId("list-toolbar-actions");

    expect(within(search).getByRole("textbox", { name: "Buscar" })).toBeVisible();
    expect(within(search).getByRole("button", { name: "Ayuda" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Filtros" })).toBeVisible();
    expect(
      within(actions).getByRole("button", { name: "Nueva Condición Fiscal" }),
    ).toHaveClass("max-w-full", "whitespace-normal");
    expect(within(actions).getByRole("button", { name: "Resetear" })).toBeVisible();
    expect(toolbar).toHaveClass("min-w-0", "md:flex-row", "md:items-center");
    expect(search).toHaveClass(
      "w-full",
      "min-w-0",
      "md:max-w-sm",
      "[&_[data-list-toolbar-search-control]]:min-h-11",
    );
    expect(within(search).getByRole("textbox", { name: "Buscar" })).toHaveAttribute(
      "data-list-toolbar-search-control",
    );
    expect(within(search).getByRole("button", { name: "Ayuda" })).not.toHaveAttribute(
      "data-list-toolbar-search-control",
    );
    expect(actions).toHaveClass("flex-wrap", "min-w-0", "[&_button]:min-h-11");
  });
});
