import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListNumberFilter, ListSelectFilter, ListTextFilter } from "./ListFilterFields";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select aria-label="native" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

describe("ListSelectFilter", () => {
  const options = [
    { value: "a", label: "Alfa" },
    { value: "b", label: "Beta" },
  ];

  it("shows the label, the all-option and the options, and reports the raw code", () => {
    const onChange = vi.fn();
    render(<ListSelectFilter label="Estado" value={undefined} onChange={onChange} options={options} />);

    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Todos" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("reports undefined when the all-option is chosen", () => {
    const onChange = vi.fn();
    render(
      <ListSelectFilter label="Estado" value="a" onChange={onChange} options={options} allLabel="Todas" />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("option", { name: "Todas" })).toBeInTheDocument();
  });
});

describe("ListNumberFilter", () => {
  it("is a labelled numeric input that reports the typed text", () => {
    const onChange = vi.fn();
    render(<ListNumberFilter label="Monto mínimo" value="" onChange={onChange} />);

    const input = screen.getByLabelText("Monto mínimo");
    expect(input).toHaveAttribute("type", "number");
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(onChange).toHaveBeenLastCalledWith("12.5");
  });

  it("sets the min attribute and ignores values below it", () => {
    const onChange = vi.fn();
    render(<ListNumberFilter label="Monto mínimo" value="" onChange={onChange} min={0} />);

    const input = screen.getByLabelText("Monto mínimo");
    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "-5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith("0");
  });
});

describe("ListTextFilter", () => {
  it("is a labelled text input that reports the typed text", () => {
    const onChange = vi.fn();
    render(<ListTextFilter label="Firmware" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Firmware"), { target: { value: "1.2.3" } });
    expect(onChange).toHaveBeenLastCalledWith("1.2.3");
  });
});
