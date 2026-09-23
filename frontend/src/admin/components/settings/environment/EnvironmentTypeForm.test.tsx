import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentTypeForm } from "./EnvironmentTypeForm";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(),
  createPending: false,
  updatePending: false,
}));

vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/admin/hooks/useEnvironment", () => ({
  useCreateEnvironmentType: () => ({
    mutateAsync: mocks.create,
    isPending: mocks.createPending,
  }),
  useUpdateEnvironmentType: () => ({
    mutateAsync: mocks.update,
    isPending: mocks.updatePending,
  }),
}));
vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: mocks.confirm,
}));

describe("EnvironmentTypeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPending = false;
    mocks.updatePending = false;
  });

  it("apila campos en móvil y conserva una fila proporcionada desde md", () => {
    render(<EnvironmentTypeForm />);

    expect(screen.getByTestId("environment-type-fields")).toHaveClass(
      "grid-cols-1",
      "md:grid-cols-[minmax(0,3fr)_auto]",
    );
    expect(screen.getByLabelText("Nombre")).toHaveClass("w-full", "min-w-0");
  });

  it("mantiene acciones táctiles 50/50 en móvil e intrínsecas en desktop", () => {
    render(<EnvironmentTypeForm />);

    expect(screen.getByTestId("form-actions")).toHaveClass("grid-cols-2", "sm:flex");
    for (const button of screen.getAllByRole("button", {
      name: /volver|crear tipo de establecimiento/i,
    })) {
      expect(button).toHaveClass("h-11", "w-full", "sm:w-auto");
    }
  });

  it("abrevia visualmente la creación en móvil sin cambiar el nombre accesible", () => {
    render(<EnvironmentTypeForm />);

    const primary = screen.getByRole("button", {
      name: "Crear Tipo de Establecimiento",
    });
    const mobileLabel = screen.getByText("Crear Tipo", { selector: "span" });
    const desktopLabel = screen.getByText("Crear Tipo de Establecimiento", {
      selector: "span",
    });

    expect(primary).toContainElement(mobileLabel);
    expect(primary).toContainElement(desktopLabel);
    expect(mobileLabel).toHaveClass("sm:hidden");
    expect(desktopLabel).toHaveClass("hidden", "sm:inline");
    expect(mobileLabel).toHaveAttribute("aria-hidden", "true");
    expect(desktopLabel).toHaveAttribute("aria-hidden", "true");
  });

  it("conserva la navegación secundaria", () => {
    render(<EnvironmentTypeForm />);

    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/admin/environments/types");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("conserva la validación requerida", async () => {
    render(<EnvironmentTypeForm />);

    fireEvent.click(screen.getByRole("button", { name: "Crear Tipo de Establecimiento" }));

    expect(await screen.findByText("El nombre es requerido")).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("confirma y crea con los valores del formulario", async () => {
    const user = userEvent.setup();
    render(<EnvironmentTypeForm />);

    await user.type(screen.getByLabelText("Nombre"), "Comercio");
    await user.click(screen.getByRole("switch", { name: "Activo" }));
    await user.click(screen.getByRole("button", { name: "Crear Tipo de Establecimiento" }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    await mocks.confirm.mock.calls[0][1]();

    expect(mocks.create).toHaveBeenCalledWith({ name: "Comercio", is_active: false });
    expect(mocks.navigate).toHaveBeenCalledWith("/admin/environments/types");
  });

  it("conserva el flujo de edición", async () => {
    const user = userEvent.setup();
    render(
      <EnvironmentTypeForm
        initialData={{ id: "env-1", name: "Oficina", isActive: false }}
      />,
    );

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Depósito");
    await user.click(screen.getByRole("button", { name: "Guardar Cambios" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    await mocks.confirm.mock.calls[0][1]();

    expect(mocks.update).toHaveBeenCalledWith({
      id: "env-1",
      data: { name: "Depósito", is_active: false },
    });
  });

  it("mantiene la etiqueta de creación accesible durante la carga", () => {
    mocks.createPending = true;

    render(<EnvironmentTypeForm />);

    expect(
      screen.getByRole("button", { name: "Crear Tipo de Establecimiento" }),
    ).toBeDisabled();
  });
});
