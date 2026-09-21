import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PermissionsDialogButton } from "./PermissionsDialogButton";

describe("PermissionsDialogButton", () => {
  it("abre el modal y muestra los permisos", async () => {
    const user = userEvent.setup();

    render(
      <PermissionsDialogButton
        permissions={["users:read", "users:update", "billing:read"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ver permisos/i }));

    expect(screen.getByText("Permisos de acceso")).toBeInTheDocument();
    expect(screen.getByText("users:read")).toBeInTheDocument();
    expect(screen.getByText("users:update")).toBeInTheDocument();
    expect(screen.getByText("billing:read")).toBeInTheDocument();
  });
});
