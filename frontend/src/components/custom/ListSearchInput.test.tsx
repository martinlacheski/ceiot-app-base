import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListSearchInput } from "./ListSearchInput";

describe("ListSearchInput", () => {
  it("uses the standard placeholder by default", () => {
    render(<ListSearchInput value="" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByPlaceholderText("Buscar en todos los campos...")).toBeInTheDocument();
  });

  it("accepts a custom placeholder and reports typing", async () => {
    const onChange = vi.fn();
    render(<ListSearchInput value="" onChange={onChange} onClear={vi.fn()} placeholder="Otro" />);
    await userEvent.type(screen.getByPlaceholderText("Otro"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("hides the clear button while empty and shows it with text", async () => {
    const onClear = vi.fn();
    const { rerender } = render(<ListSearchInput value="" onChange={vi.fn()} onClear={onClear} />);
    expect(screen.queryByRole("button", { name: "Limpiar búsqueda" })).not.toBeInTheDocument();
    rerender(<ListSearchInput value="pool" onChange={vi.fn()} onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("supports a custom aria label and class", () => {
    render(
      <ListSearchInput value="x" onChange={vi.fn()} onClear={vi.fn()} ariaLabel="Buscar cajas" className="max-w-xs" />,
    );
    expect(screen.getByRole("textbox", { name: "Buscar cajas" })).toBeInTheDocument();
    expect(screen.getByTestId("list-search-input")).toHaveClass("max-w-xs");
  });
});
