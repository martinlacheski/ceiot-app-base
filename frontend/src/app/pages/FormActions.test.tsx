import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { DeviceForm } from "@/app/components/devices/DeviceForm";
import { ChangePasswordPage } from "./profile/ChangePasswordPage";
import { ProfilePage } from "./profile/ProfilePage";

const changePassword = vi.fn();
const updateProfile = vi.fn();
const updateAccount = vi.fn();
const checkAuthStatus = vi.fn();
const navigate = vi.fn();

const user = {
  id: "user-1",
  email: "user@example.com",
  username: "user",
  firstName: "Test",
  lastName: "User",
  identificationTypeId: "identification-type-1",
  identificationNumber: "12345678",
  taxTypeId: "tax-type-1",
  birthDate: "1990-01-01",
  phone: "+5491112345678",
  cityId: "city-1",
  address: "Main Street 1",
  isSocialAuth: false,
  isAdmin: false,
};

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn((selector?: (state: object) => unknown) => {
    const state = {
      user,
      changePassword,
      updateProfile,
      updateAccount,
      checkAuthStatus,
      isAdmin: () => false,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("@/app/hooks/useDevices", () => ({
  useDeviceTypes: () => ({ data: { items: [] } }),
  useUnpairDevice: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: vi.fn((_: string, confirm: () => unknown) => confirm()),
}));

vi.mock("@/admin/actions/user.actions", () => ({
  checkEmailAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkIdentificationAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkUsernameAvailabilityAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/components/custom/SmartDatePicker", () => ({
  SmartDatePicker: () => <div />,
}));

vi.mock("@/components/custom/SmartPhoneInput", () => ({
  SmartPhoneInput: () => <input aria-label="Teléfono" />,
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({ placeholder }: { placeholder?: string }) => (
    <select aria-label={placeholder} />
  ),
}));

vi.mock("@/components/custom/AddressMapDialog", () => ({
  AddressMapDialog: () => null,
}));

vi.mock("@/app/components/profile/ProfileRoleField", () => ({
  ProfileRoleField: () => null,
}));

const renderWithRouter = (element: React.ReactNode, entry = "/form") => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/previous", entry]} initialIndex={1}>
        <Routes>
          <Route path="/previous" element={<div>Previous page</div>} />
          <Route path={entry} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const expectResponsivePair = (back: HTMLElement, primary: HTMLElement) => {
  expect(back.parentElement).toHaveClass(
    "grid",
    "grid-cols-2",
    "gap-3",
    "sm:flex",
    "sm:justify-end",
  );
  expect(back).toHaveClass("h-11", "w-full", "sm:w-auto");
  expect(primary).toHaveClass("h-11", "w-full", "sm:w-auto");
};

describe("slice 3 full-page form actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAuthStatus.mockResolvedValue(user);
  });

  it("renders Device create/edit labels, responsive actions, loading state, and back navigation", async () => {
    const { rerender } = renderWithRouter(
      <DeviceForm onSubmit={vi.fn()} isLoading />,
    );

    const create = screen.getByRole("button", { name: "Crear Dispositivo" });
    const back = screen.getByRole("button", { name: "Volver" });
    expect(create).toBeDisabled();
    expectResponsivePair(back, create);

    await userEvent.click(back);
    expect(navigate).toHaveBeenCalledWith(-1);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DeviceForm onSubmit={vi.fn()} isEditing />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Guardar Cambios" })).toBeInTheDocument();
  });

  it("renders Change Password actions and preserves validation, callback, and navigation", async () => {
    changePassword.mockResolvedValue({ success: true, message: "Updated" });
    const { container } = renderWithRouter(<ChangePasswordPage />);

    const save = screen.getByRole("button", { name: "Guardar Cambios" });
    const back = screen.getAllByRole("button", { name: "Volver" }).at(-1)!;
    expect(save).toBeDisabled();
    expectResponsivePair(back, save);
    expect(screen.getByRole("heading", { name: "Cambiar Contraseña" })).toHaveClass(
      "text-xl",
      "lg:text-2xl",
      "xl:text-3xl",
    );
    expect(container.querySelector("button svg.lucide-arrow-left")).toBeInTheDocument();
    expect(container.querySelector(".max-w-md")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contraseña Actual"), {
      target: { value: "OldPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Nueva Contraseña"), {
      target: { value: "NewPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar Contraseña"), {
      target: { value: "NewPassword1" },
    });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith(
      "OldPassword1",
      "NewPassword1",
      "NewPassword1",
    ));
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("renders Profile actions with the exact label and responsive contract", async () => {
    let resolveUpdate: (value: boolean) => void = () => undefined;
    updateProfile.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveUpdate = resolve; }),
    );
    renderWithRouter(<ProfilePage />);

    const save = await screen.findByRole("button", { name: "Guardar Cambios" });
    const back = screen.getByRole("button", { name: "Volver" });
    expect(save).toBeEnabled();
    expectResponsivePair(back, save);
    expect(screen.queryByText(/Mercado Pago/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vincular Cuenta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desvincular Cuenta/i })).not.toBeInTheDocument();

    await userEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAccessibleName("Guardar Cambios");
    expect(save.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    resolveUpdate(true);

    await userEvent.click(back);
    expect(navigate).toHaveBeenCalledWith(-1);
  });
});
