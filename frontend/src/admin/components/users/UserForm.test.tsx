import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserForm } from "./UserForm";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey[0];

    if (key === "identificationTypes") {
      return { data: { items: [{ id: "dni", name: "DNI" }] } };
    }

    if (key === "permissions") {
      return {
        data: {
          groups: [
            {
              label: "Usuarios",
              items: [{ value: "user:me", label: "Mi perfil" }],
            },
          ],
        },
      };
    }

    return { data: undefined };
  },
}));

vi.mock("@/admin/actions/user.actions", () => ({
  checkEmailAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkIdentificationAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkUsernameAvailabilityAction: vi.fn().mockResolvedValue(true),
  getPermissionsAction: vi.fn().mockResolvedValue({ groups: [] }),
}));

vi.mock("@/admin/actions/identification.actions", () => ({
  getIdentificationTypesAction: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label="searchable-select"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Seleccione</option>
      <option value="mock-value">Mock</option>
    </select>
  ),
}));

vi.mock("@/components/custom/SmartPhoneInput", () => ({
  SmartPhoneInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label="smart-phone-input"
      placeholder={placeholder}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/custom/SmartDatePicker", () => ({
  SmartDatePicker: ({ value }: { value?: Date }) => (
    <input
      aria-label="smart-date-picker"
      value={value?.toISOString() || ""}
      readOnly
    />
  ),
}));

vi.mock("@/components/custom/AddressMapDialog", () => ({
  AddressMapDialog: () => <div data-testid="address-map-dialog" />,
}));

vi.mock("lucide-react", async () => {
  const actual =
    await vi.importActual<typeof import("lucide-react")>("lucide-react");

  return {
    ...actual,
    Loader2: (props: React.ComponentProps<"span">) => (
      <span {...props}>loader</span>
    ),
  };
});

describe("UserForm", () => {
  it("muestra la guía exacta del teléfono al crear y editar", () => {
    const { rerender } = render(<UserForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("smart-phone-input")).toHaveAttribute(
      "placeholder",
      "Ingrese el teléfono",
    );

    rerender(<UserForm mode="edit" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("smart-phone-input")).toHaveAttribute(
      "placeholder",
      "Ingrese el teléfono",
    );
  });

  it("apila todos los pares en móvil y conserva dos columnas desde md", () => {
    render(<UserForm mode="create" onSubmit={vi.fn()} />);

    [
      "name-fields",
      "identification-fields",
      "address-fields",
      "account-fields",
      "password-fields",
    ].forEach((testId) => {
      expect(screen.getByTestId(testId)).toHaveClass(
        "grid-cols-1",
        "md:grid-cols-2",
      );
      expect(screen.getByTestId(testId)).not.toHaveClass("grid-cols-2");
    });
  });

  it("mantiene dirección y acciones utilizables en móvil", () => {
    render(<UserForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId("address-action")).toHaveClass(
      "min-w-0",
      "flex-col",
      "sm:flex-row",
    );
    expect(screen.getByRole("button", { name: /abrir mapa/i })).toHaveClass(
      "h-11",
      "w-full",
      "sm:w-auto",
    );
    expect(screen.getByTestId("form-actions")).toHaveClass(
      "grid-cols-2",
      "sm:flex",
    );
    expect(screen.getByRole("button", { name: "Volver" })).toHaveClass(
      "h-11",
      "w-full",
      "sm:w-auto",
    );
    expect(screen.getByRole("button", { name: "Crear Usuario" })).toHaveClass(
      "h-11",
      "w-full",
      "sm:w-auto",
    );
  });

  it("mantiene los nombres exactos y deshabilita ambas acciones durante el envío", () => {
    render(
      <UserForm
        mode="edit"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting
      />,
    );

    expect(screen.getByRole("button", { name: "Volver" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Guardar Cambios" }),
    ).toBeDisabled();
    expect(screen.getByText("loader")).toHaveAttribute("aria-hidden", "true");
  });

  it("mantiene la etiqueta exacta de creación durante el envío", () => {
    render(
      <UserForm
        mode="create"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting
      />,
    );

    expect(
      screen.getByRole("button", { name: "Crear Usuario" }),
    ).toBeDisabled();
  });

  it("conserva el callback secundario sin enviar el formulario", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<UserForm mode="edit" onSubmit={onSubmit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("muestra contraseñas solo al crear", () => {
    const { rerender } = render(<UserForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/^contraseña \*$/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^confirmar contraseña \*$/i),
    ).toBeInTheDocument();

    rerender(<UserForm mode="edit" onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it("conserva la validación requerida al crear", async () => {
    const onSubmit = vi.fn();
    render(<UserForm mode="create" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Crear Usuario" }));

    expect(
      await screen.findByText("El nombre es requerido"),
    ).toBeInTheDocument();
    expect(screen.getByText("La contraseña es requerida")).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("muestra el patrón de mapa con dirección readonly en edición", () => {
    render(
      <UserForm
        mode="edit"
        defaultValues={{
          email: "admin@example.com",
          username: "admin",
          firstName: "Ada",
          lastName: "Lovelace",
          identificationNumber: "12345678",
          identificationTypeId: "dni",
          cityId: "city-1",
          address: "Av. Siempre Viva 742",
          permissions: ["user:me"],
          isActive: true,
          isAdmin: false,
        }}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /abrir mapa/i }),
    ).toBeInTheDocument();

    const addressInput = screen.getByDisplayValue("Av. Siempre Viva 742");
    expect(addressInput).toHaveAttribute("readonly");
    expect(screen.queryByText("Ciudad")).not.toBeInTheDocument();
  });
});
