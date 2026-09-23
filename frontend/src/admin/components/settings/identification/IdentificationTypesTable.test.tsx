import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIdentificationTypes } from "@/admin/hooks/useIdentification";
import { IdentificationTypesTable } from "./IdentificationTypesTable";

vi.mock("@/admin/hooks/useIdentification", () => ({
  useIdentificationTypes: vi.fn(),
  useDeleteIdentificationType: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateIdentificationType: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({ user: { username: "admin" } })),
}));

vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: vi.fn() }));

vi.mock("@/lib/export.utils", () => ({
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
}));

vi.mock("@/components/custom/DataTableColumnHeader", () => ({
  DataTableColumnHeader: ({
    column,
    title,
  }: {
    column: { toggleSorting: (descending: boolean) => void };
    title: string;
  }) => <button onClick={() => column.toggleSorting(true)}>{title}</button>,
}));

function CurrentSort() {
  return (
    <output data-testid="current-sort">
      {new URLSearchParams(useLocation().search).get("sort")}
    </output>
  );
}

describe("IdentificationTypesTable URL sorting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIdentificationTypes).mockReturnValue({
      data: { items: [], total: 0, pages: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useIdentificationTypes>);
  });

  it("uses the URL sort when requesting identification types", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/settings/identification-types?page=3&sort=is_active%3Aasc",
        ]}
      >
        <IdentificationTypesTable />
      </MemoryRouter>,
    );

    expect(useIdentificationTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3, sort: "is_active:asc" }),
    );
  });

  it("writes a header sort to the URL and resets the page", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/settings/identification-types?page=3&size=20",
        ]}
      >
        <IdentificationTypesTable />
        <CurrentSort />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Estado" }));

    await waitFor(() =>
      expect(screen.getByTestId("current-sort")).toHaveTextContent(
        "is_active:desc",
      ),
    );
    expect(useIdentificationTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        size: 20,
        sort: "is_active:desc",
      }),
    );
  });

  it("does not send a partial sort when the URL sort is invalid", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/settings/identification-types?sort=name%3Aasc%2Cunknown%3Adesc",
        ]}
      >
        <IdentificationTypesTable />
      </MemoryRouter>,
    );

    expect(useIdentificationTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: undefined }),
    );
  });
});
