import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CityForm } from "./CityForm";
import { CountryForm } from "./CountryForm";
import { StateForm } from "./StateForm";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), confirm: vi.fn() }));

vi.mock("@/admin/hooks/useLocations", () => ({
  useCountries: () => ({ data: { items: [] } }),
  useStates: () => ({ data: { items: [] } }),
}));
vi.mock("@/store/confirm.store", () => ({ showConfirmDialog: mocks.confirm }));

type Mode = "create" | "edit";
const statusValues = (isActive?: boolean) => isActive === undefined ? {} : { is_active: isActive };

const forms = [
  { name: "CountryForm", createLabel: "Crear País", render: (mode: Mode = "create", pending = false, isActive = mode === "edit" ? false : undefined, onSubmit = vi.fn()) => render(<CountryForm mode={mode} defaultValues={{ ...(mode === "edit" ? { name: "Argentina" } : {}), ...statusValues(isActive) }} onSubmit={onSubmit} onCancel={mocks.cancel} isSubmitting={pending} />) },
  { name: "StateForm", createLabel: "Crear Provincia", render: (mode: Mode = "create", pending = false, isActive = mode === "edit" ? false : undefined, onSubmit = vi.fn()) => render(<StateForm mode={mode} defaultValues={{ ...(mode === "edit" ? { name: "Córdoba", country_id: "country-1" } : {}), ...statusValues(isActive) }} onSubmit={onSubmit} onCancel={mocks.cancel} isSubmitting={pending} />) },
  { name: "CityForm", createLabel: "Crear Ciudad", render: (mode: Mode = "create", pending = false, isActive = mode === "edit" ? false : undefined, onSubmit = vi.fn()) => render(<CityForm mode={mode} defaultValues={{ ...(mode === "edit" ? { name: "Rosario", postal_code: "2000", state_id: "state-1", country_id: "country-1" } : {}), ...statusValues(isActive) }} onSubmit={onSubmit} onCancel={mocks.cancel} isSubmitting={pending} />) },
];

describe.each(forms)("$name", ({ createLabel, render: renderForm }) => {
  beforeEach(() => vi.clearAllMocks());

  it("renders exact create actions with the responsive contract", () => {
    renderForm();
    const back = screen.getByRole("button", { name: "Volver" });
    const primary = screen.getByRole("button", { name: createLabel });

    expect(screen.getByTestId("form-actions")).toHaveClass("grid-cols-2", "sm:flex");
    expect(back).toHaveClass("h-11", "w-full", "sm:w-auto");
    expect(primary).toHaveClass("h-11", "w-full", "sm:w-auto");
    fireEvent.click(back);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("keeps the edit label accessible while submitting", () => {
    renderForm("edit", true);
    expect(screen.getByRole("button", { name: "Guardar Cambios" })).toBeDisabled();
  });

  it("keeps the create label accessible while submitting", () => {
    renderForm("create", true);
    expect(screen.getByRole("button", { name: createLabel })).toBeDisabled();
  });

  it("renders the active default in an accessible undecorated status row", () => {
    renderForm();
    const status = screen.getByRole("switch", { name: "Estado" });
    const row = status.parentElement;

    expect(status).toHaveAttribute("aria-checked", "true");
    expect(row).toHaveTextContent("Activo");
    expect(row).toHaveClass("flex", "min-h-11", "items-center", "gap-2");
    expect(row).not.toHaveClass("border", "rounded-md", "rounded-lg", "bg-background", "p-3");
  });

  it("preserves edit false and updates status text through both toggle transitions", () => {
    renderForm("edit");
    const status = screen.getByRole("switch", { name: "Estado" });

    expect(status).toHaveAttribute("aria-checked", "false");
    expect(status.parentElement).toHaveTextContent("Inactivo");
    fireEvent.click(status);
    expect(status).toHaveAttribute("aria-checked", "true");
    expect(status.parentElement).toHaveTextContent("Activo");
    fireEvent.click(status);
    expect(status).toHaveAttribute("aria-checked", "false");
    expect(status.parentElement).toHaveTextContent("Inactivo");
  });

  it("submits the current inactive boolean after confirmation", async () => {
    const onSubmit = vi.fn();
    renderForm("edit", false, false, onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    mocks.confirm.mock.calls[0][1]();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });
});
