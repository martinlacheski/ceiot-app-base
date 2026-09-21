import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAuthStore } from "@/auth/store/auth.store";

import InvitationAcceptPage from "./InvitationAcceptPage";
import { getInvitationAction } from "@/app/actions/invitation.actions";

const invitationMock = {
  id: "inv-1",
  email: "guest@example.com",
  status: "pending",
  environment_name: "Café Centro",
  scope_name: "Device 42",
  scope_type: "device" as const,
  owner_email: "owner@example.com",
  environment_id: "env-1",
  is_active: true,
  invitedUserExists: false,
};

vi.mock("@/app/actions/invitation.actions", () => ({
  getInvitationAction: vi.fn(),
  acceptInvitationAction: vi.fn(),
  declineInvitationAction: vi.fn(),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({
    authStatus: "not-authenticated",
    user: null,
  })),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("InvitationAcceptPage", () => {
  beforeEach(() => {
    vi.mocked(getInvitationAction).mockResolvedValue(invitationMock);
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "not-authenticated",
      user: null,
    });
  });

  const renderPage = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/invitations/accept?id=inv-1"]}>
          <Routes>
            <Route
              path="/invitations/accept"
              element={<InvitationAcceptPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it("prioritizes registration for unauthenticated invited emails without an account", async () => {
    renderPage();

    expect(
      await screen.findByText(/creá una cuenta con el correo electrónico/i)
    ).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Device 42").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /crear cuenta para aceptar/i })
    ).toHaveAttribute(
      "href",
      "/auth/register?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    );
    expect(screen.queryByRole("link", { name: /ya tengo cuenta/i })).not.toBeInTheDocument();
  });

  it("prioritizes login for unauthenticated invited emails with an account", async () => {
    vi.mocked(getInvitationAction).mockResolvedValue({
      ...invitationMock,
      invitedUserExists: true,
    });

    renderPage();

    expect(
      await screen.findByText(/ingresá con el correo electrónico invitado/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /ingresar para aceptar/i })
    ).toHaveAttribute(
      "href",
      "/auth/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    );
    expect(screen.queryByRole("link", { name: /crear otra cuenta/i })).not.toBeInTheDocument();
  });

  it("keeps accept and decline actions for authenticated invited users", async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "authenticated",
      user: { email: "guest@example.com" },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /aceptar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rechazar/i })).toBeInTheDocument();
  });
});
