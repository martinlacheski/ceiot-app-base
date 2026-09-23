import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./ThemeToggle";

const { toggleTheme, useThemeMock } = vi.hoisted(() => ({
  toggleTheme: vi.fn(),
  useThemeMock: vi.fn(),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => useThemeMock(),
}));

describe("ThemeToggle", () => {
  it("offers to switch to dark mode while in light mode", () => {
    useThemeMock.mockReturnValue({ theme: "light", toggleTheme });

    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Cambiar a modo oscuro" }),
    ).toBeInTheDocument();
  });

  it("offers to switch to light mode while in dark mode", () => {
    useThemeMock.mockReturnValue({ theme: "dark", toggleTheme });

    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Cambiar a modo claro" }),
    ).toBeInTheDocument();
  });

  it("toggles the theme on click", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "light", toggleTheme });

    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Cambiar a modo oscuro" }));

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
