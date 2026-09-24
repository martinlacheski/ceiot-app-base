import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CatalogFormPage } from "./CatalogFormPage";

vi.mock("./catalogApi", () => ({ catalogApi: { list: vi.fn().mockResolvedValue({ items: [] }) } }));

function renderForm(kind: "sensors" | "variables") {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CatalogFormPage kind={kind} /></MemoryRouter></QueryClientProvider>);
}

describe("catalog forms", () => {
  it("uses the standard variable title, desktop field row and form actions", () => {
    renderForm("variables");
    expect(screen.getByRole("heading", { name: "Nueva variable" })).toBeInTheDocument();
    expect(screen.getByTestId("catalog-main-fields")).toHaveClass("md:grid-cols-3");
    expect(screen.getByTestId("form-actions")).toHaveClass("grid-cols-2", "sm:flex");
    expect(within(screen.getByTestId("form-actions")).getByRole("button", { name: "Volver" })).toHaveClass("h-11");
  });

  it("shows an empty measurement table and adds a row with empty numeric inputs", () => {
    renderForm("sensors");
    expect(screen.getByRole("heading", { name: "Nuevo sensor" })).toBeInTheDocument();
    expect(screen.getByText("No hay variables agregadas.")).toBeInTheDocument();
    // Primary (black) button, like "Agregar sensor" in the device form.
    expect(screen.getByRole("button", { name: "Agregar variable" })).toHaveClass("bg-primary");
    fireEvent.click(screen.getByRole("button", { name: "Agregar variable" }));
    expect(screen.getByRole("button", { name: "Quitar variable" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Mín 1" })).toHaveValue(null);
    expect(screen.getByRole("spinbutton", { name: "Máx 1" })).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "sensor_1" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Sensor" } });
    fireEvent.change(screen.getByLabelText("Fabricante"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sensor" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Selecciona una variable en cada fila.");
  });
});
