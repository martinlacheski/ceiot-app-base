import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "./SearchableSelect";

const options = [
  { value: "1", label: "Alpha" },
  { value: "2", label: "Beta" },
];

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const openSelect = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox"));
  return screen.findByPlaceholderText("Buscar...");
};

describe("SearchableSelect", () => {
  it("filters the options locally by default", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect options={options} onChange={vi.fn()} />);

    await user.type(await openSelect(user), "alp");

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("reports the typed text through onSearchChange", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <SearchableSelect
        options={options}
        onChange={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );

    await user.type(await openSelect(user), "be");

    expect(onSearchChange).toHaveBeenLastCalledWith("be");
  });

  it("lists every option as given when local filtering is turned off", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        options={options}
        onChange={vi.fn()}
        shouldFilter={false}
      />,
    );

    await user.type(await openSelect(user), "zzz");

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("clears the search term when the list is closed", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <SearchableSelect
        options={options}
        onChange={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );

    await user.type(await openSelect(user), "be");
    await user.keyboard("{Escape}");

    expect(onSearchChange).toHaveBeenLastCalledWith("");
  });

  it("shows a loading message instead of the empty one while loading", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        options={[]}
        onChange={vi.fn()}
        isLoading
        emptyMessage="Nada"
      />,
    );

    await openSelect(user);

    expect(screen.getByText("Buscando...")).toBeInTheDocument();
    expect(screen.queryByText("Nada")).not.toBeInTheDocument();
  });

  it("falls back to selectedLabel when the value is not among the options", () => {
    render(
      <SearchableSelect
        options={options}
        value="9"
        selectedLabel="Omega"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("Omega");
  });

  it("keeps showing the label of an option that is in the list", () => {
    render(<SearchableSelect options={options} value="2" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Beta");
  });
});
