import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("places an icon-only back link beside the title when backUrl is given", () => {
    render(<MemoryRouter><PageHeader title="Título" subtitle="Sub" backUrl="/app/devices" /></MemoryRouter>);
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveAttribute("href", "/app/devices");
    expect(back.textContent).toBe("");
    expect(back).toHaveClass("size-11");
    expect(back.parentElement).toBe(screen.getByRole("heading", { name: "Título" }).parentElement?.parentElement);
  });

  it("keeps root headers without a back control and preserves actions and children", () => {
    render(<MemoryRouter><PageHeader title="Root" subtitle="Sub" actions={<button>Action</button>}><p>Child</p></PageHeader></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Volver" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
  });
});
