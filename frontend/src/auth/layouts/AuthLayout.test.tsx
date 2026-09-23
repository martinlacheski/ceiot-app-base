import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { LANDING_URL } from "@/config/publicUrls";
import AuthLayout from "./AuthLayout";

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={["/auth/login"]}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<p>Login</p>} />
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
});
