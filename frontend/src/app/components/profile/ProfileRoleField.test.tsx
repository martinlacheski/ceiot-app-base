import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProfileRoleField } from "./ProfileRoleField";

describe("ProfileRoleField", () => {
  it("keeps the admin badge and permissions trigger in one aligned row", () => {
    render(
      <ProfileRoleField
        isAdmin
        showPermissions
        permissions={["users:read"]}
      />,
    );

    const row = screen.getByTestId("profile-role-row");
    const trigger = screen.getByRole("button", { name: /ver permisos/i });

    expect(row).toHaveClass(
      "flex-nowrap",
      "items-center",
      "gap-2",
      "min-w-0",
    );
    expect(row.className).not.toMatch(/\bml-3\b|\bflex-wrap\b/);
    expect(trigger).toHaveClass("h-11", "md:h-9", "shrink");
  });

  it.each([
    { showPermissions: false, permissions: ["users:read"] },
    { showPermissions: true, permissions: [] },
    { showPermissions: true, permissions: undefined },
  ])("hides the trigger unless the admin has permissions", (props) => {
    render(<ProfileRoleField isAdmin {...props} />);

    expect(
      screen.queryByRole("button", { name: /ver permisos/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the existing effective permissions dialog", async () => {
    const user = userEvent.setup();
    render(
      <ProfileRoleField
        isAdmin
        showPermissions
        permissions={["users:read", "users:update"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ver permisos/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Permisos efectivos del usuario autenticado.",
    );
    expect(screen.getByText("users:read")).toBeInTheDocument();
    expect(screen.getByText("users:update")).toBeInTheDocument();
  });
});
