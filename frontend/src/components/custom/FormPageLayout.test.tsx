import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { FormPageLayout } from "./FormPageLayout";

const renderLayout = (hideBackButton?: boolean) =>
  render(
    <MemoryRouter>
      <FormPageLayout
        title="Formulario"
        subtitle="Descripción"
        hideBackButton={hideBackButton}
      >
        <p>Contenido</p>
      </FormPageLayout>
    </MemoryRouter>,
  );

describe("FormPageLayout", () => {
  it("muestra la flecha de volver por defecto", () => {
    renderLayout();
    const back = screen.getByRole("button", { name: "Volver" });
    expect(back).toHaveClass("size-11");
    expect(back.textContent).toBe("");
    expect(back.querySelector("svg.lucide-arrow-left")).toBeInTheDocument();
  });

  it("oculta la flecha en una pantalla raíz del sidebar", () => {
    renderLayout(true);
    expect(screen.queryByRole("button", { name: "Volver" })).not.toBeInTheDocument();
  });
});
