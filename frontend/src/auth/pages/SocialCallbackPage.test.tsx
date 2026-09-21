import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { SocialCallbackPage } from "./SocialCallbackPage";

const checkAuthStatus = vi.fn();

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { checkAuthStatus: typeof checkAuthStatus }) => unknown) =>
    selector({ checkAuthStatus }),
}));

describe("SocialCallbackPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    checkAuthStatus.mockReset();
    checkAuthStatus.mockResolvedValue(true);
  });

  const renderPage = (initialEntry = "/auth/social-callback") => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/auth/social-callback" element={<SocialCallbackPage />} />
            <Route path="/app" element={<div>Dashboard</div>} />
            <Route path="/invitations/accept" element={<div>Invitation Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("redirects to stored invitation return path after social login", async () => {
    window.sessionStorage.setItem("auth:returnTo", "/invitations/accept?id=inv-1");

    renderPage();

    expect(await screen.findByText("Invitation Page")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("auth:returnTo")).toBeNull();
  });

  it("redirects to callback next query after social login", async () => {
    renderPage("/auth/social-callback?next=%2Finvitations%2Faccept%3Fid%3Dinv-1");

    expect(await screen.findByText("Invitation Page")).toBeInTheDocument();
  });

  it("redirects to dashboard when no invitation return path exists", async () => {
    renderPage();

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });
});
