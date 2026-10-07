import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Table } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";

import { DataTablePagination } from "./DataTablePagination";

describe("DataTablePagination", () => {
  it("keeps mobile navigation accessible and delegates pagination to the table", async () => {
    const user = userEvent.setup();
    const nextPage = vi.fn();
    const table = {
      getState: () => ({ pagination: { pageIndex: 1, pageSize: 10 } }),
      getPageCount: () => 4,
      getCanPreviousPage: () => true,
      getCanNextPage: () => true,
      previousPage: vi.fn(),
      nextPage,
      setPageIndex: vi.fn(),
      setPageSize: vi.fn(),
      getFilteredRowModel: () => ({ rows: [] }),
    } as unknown as Table<unknown>;

    render(
      <DataTablePagination
        table={table}
        totalItems={34}
        entityName="establecimientos"
      />,
    );

    expect(screen.getByText("34 establecimientos en total")).toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 4/)).toBeInTheDocument();
    const nextButton = screen.getByRole("button", {
      name: "Ir a la página siguiente",
    });
    expect(nextButton).toHaveClass("size-11", "md:size-8");
    await user.click(nextButton);
    expect(nextPage).toHaveBeenCalledOnce();
  });

  const tableStub = {
    getState: () => ({ pagination: { pageIndex: 0, pageSize: 10 } }),
    getPageCount: () => 1,
    getCanPreviousPage: () => false,
    getCanNextPage: () => false,
    previousPage: vi.fn(),
    nextPage: vi.fn(),
    setPageIndex: vi.fn(),
    setPageSize: vi.fn(),
    getFilteredRowModel: () => ({ rows: [{}] }),
  } as unknown as Table<unknown>;

  it("uses the singular name when there is exactly one item and one is given", () => {
    const { rerender } = render(
      <DataTablePagination
        table={tableStub}
        totalItems={1}
        entityName="firmwares"
        entityNameSingular="firmware"
      />,
    );
    expect(screen.getByText("1 firmware en total")).toBeInTheDocument();

    rerender(
      <DataTablePagination
        table={tableStub}
        totalItems={2}
        entityName="firmwares"
        entityNameSingular="firmware"
      />,
    );
    expect(screen.getByText("2 firmwares en total")).toBeInTheDocument();
  });

  it("uses the singular name for one filtered row without a total", () => {
    render(
      <DataTablePagination
        table={tableStub}
        entityName="firmwares"
        entityNameSingular="firmware"
      />,
    );
    expect(screen.getByText("1 firmware")).toBeInTheDocument();
  });

  it("keeps the plural name for one item when no singular is given", () => {
    render(<DataTablePagination table={tableStub} totalItems={1} entityName="registros" />);
    expect(screen.getByText("1 registros en total")).toBeInTheDocument();
  });
});
