import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CenteredHeader } from "./CenteredHeader";
import { CENTERED_CELL_CLASS } from "./tableAlignment";

describe("table alignment standard", () => {
  it("centers a plain header", () => {
    render(<CenteredHeader className="extra">Acciones</CenteredHeader>);
    expect(screen.getByText("Acciones")).toHaveClass("text-center", "extra");
  });

  it("documents centered cells as text-center", () => {
    expect(CENTERED_CELL_CLASS).toBe("text-center");
  });
});
