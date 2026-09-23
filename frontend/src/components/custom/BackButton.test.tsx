import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { BackButton } from "./BackButton";

describe("BackButton", () => {
  it("renders a 44px, icon-only link with a default accessible name", () => {
    render(<MemoryRouter><BackButton to="/app/devices" /></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Volver" });
    expect(link).toHaveAttribute("href", "/app/devices");
    expect(link.textContent).toBe("");
    expect(link).toHaveClass("size-11");
    expect(link).toHaveClass("border-border", "bg-background", "hover:bg-accent");
    expect(link.querySelector("svg")).toBeInTheDocument();
  });

  it("renders a button with a custom name and invokes its handler", async () => {
    const onClick = vi.fn();
    render(<BackButton onClick={onClick} label="Volver a países" />);
    const button = screen.getByRole("button", { name: "Volver a países" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("size-11");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
