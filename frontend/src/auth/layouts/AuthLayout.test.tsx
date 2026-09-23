import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { LANDING_URL } from "@/config/publicUrls";
import AuthLayout from "./AuthLayout";

const renderLayout = (path = "/auth/login") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<p>Login</p>} />
          <Route path="/auth/register" element={<p>Register</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("AuthLayout", () => {
  it("offers the light/dark theme toggle on every auth screen", () => {
    renderLayout();

    expect(
      screen.getByRole("button", { name: /Cambiar a modo/i }),
    ).toBeInTheDocument();
  });

  it("offers a link back to the landing site on every auth screen", () => {
    renderLayout();

    expect(
      screen.getByRole("link", { name: /Volver al inicio/i }),
    ).toHaveAttribute("href", LANDING_URL);
  });

  it("puts the theme toggle and the back link on the same row", () => {
    renderLayout();

    const back = screen.getByRole("link", { name: /Volver al inicio/i });
    const toggle = screen.getByRole("button", { name: /Cambiar a modo/i });

    expect(toggle.parentElement).toBe(back.parentElement);
  });

  it("aligns the top row with the card width of each screen", () => {
    renderLayout("/auth/register");
    const registerRow = screen.getByRole("link", { name: /Volver al inicio/i }).parentElement;
    expect(registerRow).toHaveClass("max-w-4xl");
    expect(registerRow).not.toHaveClass("max-w-md");
  });

  it("keeps the narrow row for the sign-in card", () => {
    renderLayout("/auth/login");
    const loginRow = screen.getByRole("link", { name: /Volver al inicio/i }).parentElement;
    expect(loginRow).toHaveClass("max-w-md");
  });
});
