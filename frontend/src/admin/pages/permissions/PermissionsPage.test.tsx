import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionsPage } from "./PermissionsPage";

vi.mock("@/admin/components/permissions/PermissionsTable", () => ({
  PermissionsTable: () => <div>permissions table</div>,
}));

vi.mock("@/app/components/PageHeader", () => ({
  PageHeader: ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle: string;
    children?: React.ReactNode;
  }) => (
    <section aria-label={title}>
      <p>{subtitle}</p>
      {children}
    </section>
  ),
}));

describe("PermissionsPage", () => {
  it("places the list inside the standard page header layout", () => {
    render(<PermissionsPage />);

    const page = screen.getByRole("region", { name: "Permisos" });
    expect(page).toHaveTextContent("Gestión de roles y permisos de usuarios");
    expect(page).toHaveTextContent("permissions table");
  });
});
