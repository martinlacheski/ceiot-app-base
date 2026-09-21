import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ListSortControls } from "../ListSortControls";

const options = [
  { value: "name", label: "Nombre" },
  { value: "status", label: "Estado" },
] as const;

describe("ListSortControls", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("exposes reusable 44px field and direction controls", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onDirectionChange = vi.fn();

    render(
      <ListSortControls
        options={options}
        value="name"
        direction="asc"
        onValueChange={onValueChange}
        onDirectionChange={onDirectionChange}
      />,
    );

    expect(screen.getByLabelText("Ordenar por")).toHaveClass("min-h-11", "w-full");
    expect(screen.getByLabelText("Dirección")).toHaveClass("min-h-11", "w-full");

    await user.click(screen.getByLabelText("Dirección"));
    await user.click(screen.getByRole("option", { name: "Descendente" }));
    expect(onDirectionChange).toHaveBeenCalledWith("desc");

    await user.click(screen.getByLabelText("Ordenar por"));
    await user.click(screen.getByRole("option", { name: "Sin ordenar" }));
    expect(onValueChange).toHaveBeenCalledWith(undefined);
  });

  it("labels both grouped controls and disables direction without a field", async () => {
    const user = userEvent.setup();

    render(
      <ListSortControls
        options={options}
        direction="asc"
        onValueChange={vi.fn()}
        onDirectionChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Ordenar por")).toHaveTextContent("Sin ordenar");
    expect(screen.getByLabelText("Dirección")).toBeDisabled();

    await user.click(screen.getByLabelText("Ordenar por"));
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Estado" })).toBeInTheDocument();
  });
});
