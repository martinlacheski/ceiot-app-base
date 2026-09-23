import { render } from "@testing-library/react";
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
    const { container } = renderLayout();
    expect(container.querySelector("button svg.lucide-arrow-left")).toBeInTheDocument();
  });

  it("oculta la flecha en una pantalla raíz del sidebar", () => {
    const { container } = renderLayout(true);
    expect(container.querySelector("button svg.lucide-arrow-left")).not.toBeInTheDocument();
  });
});
