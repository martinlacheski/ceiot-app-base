import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ProfilePage } from "./ProfilePage";

vi.mock("@/auth/store/auth.store", () => {
  const state = () => ({
    user: {},
    updateProfile: vi.fn(),
    updateAccount: vi.fn(),
    checkAuthStatus: vi.fn().mockResolvedValue({}),
    isAdmin: () => false,
  });
  return {
    useAuthStore: (selector?: (value: ReturnType<typeof state>) => unknown) =>
      selector ? selector(state()) : state(),
  };
});

vi.mock("@/admin/actions/identification.actions", () => ({
  getIdentificationTypesAction: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@/admin/actions/user.actions", () => ({
  checkEmailAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkIdentificationAvailabilityAction: vi.fn().mockResolvedValue(true),
  checkUsernameAvailabilityAction: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/components/custom/SmartDatePicker", () => ({ SmartDatePicker: () => null }));
vi.mock("@/components/custom/SmartPhoneInput", () => ({ SmartPhoneInput: () => null }));
vi.mock("@/components/custom/SearchableSelect", () => ({ SearchableSelect: () => null }));
vi.mock("@/components/custom/AddressMapDialog", () => ({ AddressMapDialog: () => null }));
vi.mock("@/app/components/profile/ProfileRoleField", () => ({ ProfileRoleField: () => null }));

describe("ProfilePage layout", () => {
  it("no muestra la flecha del layout porque Mi perfil es raíz del sidebar", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector("button svg.lucide-arrow-left")).not.toBeInTheDocument();
  });
});
