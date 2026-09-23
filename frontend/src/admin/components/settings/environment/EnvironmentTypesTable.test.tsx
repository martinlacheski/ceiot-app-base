import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEnvironmentTypes } from "@/admin/hooks/useEnvironment";
import { EnvironmentTypesTable } from "./EnvironmentTypesTable";

vi.mock("@/admin/hooks/useEnvironment", () => ({
  useEnvironmentTypes: vi.fn(),
  useDeleteEnvironmentType: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateEnvironmentType: vi.fn(() => ({ mutateAsync: vi.fn() })),
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

describe("EnvironmentTypesTable URL sorting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEnvironmentTypes).mockReturnValue({
      data: { items: [], total: 0, pages: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useEnvironmentTypes>);
  });

  it("uses the URL sort when requesting environment types", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/settings/environment-types?page=3&sort=name%3Adesc",
        ]}
      >
        <EnvironmentTypesTable />
      </MemoryRouter>,
    );

    expect(useEnvironmentTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3, sort: "name:desc" }),
    );
  });

  it("writes a header sort to the URL and resets the page", async () => {
    render(
      <MemoryRouter
        initialEntries={["/admin/settings/environment-types?page=3&size=20"]}
      >
        <EnvironmentTypesTable />
        <CurrentSort />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nombre" }));

    await waitFor(() =>
      expect(screen.getByTestId("current-sort")).toHaveTextContent("name:desc"),
    );
    expect(useEnvironmentTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, size: 20, sort: "name:desc" }),
    );
  });

  it("does not send a partial sort when the URL sort is invalid", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/admin/settings/environment-types?sort=name%3Aasc%2Cunknown%3Adesc",
        ]}
      >
        <EnvironmentTypesTable />
      </MemoryRouter>,
    );

    expect(useEnvironmentTypes).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: undefined }),
    );
  });
});
