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
});
