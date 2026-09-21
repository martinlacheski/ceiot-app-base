import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Header } from "./Header";
import { useAuthStore } from "@/auth/store/auth.store";
import { MemoryRouter } from "react-router";

// Mock store
vi.mock("@/auth/store/auth.store");

// Mock components that might cause issues with resizing/observers
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserver;

describe("Header Component", () => {
  const mockLogout = vi.fn();
  const mockUpdateProfile = vi.fn();
  const mockChangePassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to not authenticated
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "not-authenticated",
      user: null,
      isAdmin: vi.fn().mockReturnValue(false),
      logout: mockLogout,
      updateProfile: mockUpdateProfile,
      changePassword: mockChangePassword,
    } as unknown);
  });

  it("should render login button when not authenticated", () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByText("Mi cuenta")).not.toBeInTheDocument();
  });

  it("should not render the search field", () => {
    const { container } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole("textbox", { name: /buscar/i })
    ).not.toBeInTheDocument();
    expect(
      container.querySelector("input[name='search']")
    ).not.toBeInTheDocument();
  });

  it("should render user menu when authenticated", () => {
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "authenticated",
      user: { username: "testuser", email: "test@test.com", permissions: [] },
      isAdmin: vi.fn().mockReturnValue(false),
      logout: mockLogout,
      updateProfile: mockUpdateProfile,
      changePassword: mockChangePassword,
    } as unknown);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByText("Mi cuenta")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" })
    ).not.toBeInTheDocument();
  });

  it("should render admin panel link when user is admin", () => {
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "authenticated",
      user: {
        username: "admin",
        email: "admin@test.com",
        isAdmin: true,
        permissions: [],
      },
      isAdmin: vi.fn().mockReturnValue(true),
      logout: mockLogout,
      updateProfile: mockUpdateProfile,
      changePassword: mockChangePassword,
    } as unknown);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByText("Panel")).toBeInTheDocument();
  });

  it("should have correct link to profile page", async () => {
    const user = userEvent.setup();
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "authenticated",
      user: { username: "testuser", firstName: "Juana", lastName: "Perez" },
      isAdmin: vi.fn().mockReturnValue(false),
      logout: mockLogout,
      updateProfile: mockUpdateProfile,
      changePassword: mockChangePassword,
    } as unknown);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    // Open Dropdown
    await user.click(screen.getByText("Mi cuenta"));

    // Check Link
    const infoLink = screen.getByRole("menuitem", {
      name: /Información Personal/i,
    });
    expect(infoLink).toHaveAttribute("href", "/app/profile");
  });

  it("should have correct link to change password page", async () => {
    const user = userEvent.setup();
    vi.mocked(useAuthStore).mockReturnValue({
      authStatus: "authenticated",
      user: { username: "testuser" },
      isAdmin: vi.fn().mockReturnValue(false),
      logout: mockLogout,
      updateProfile: mockUpdateProfile,
      changePassword: mockChangePassword,
    } as unknown);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    // Open Dropdown
    await user.click(screen.getByText("Mi cuenta"));

    const pwdLink = screen.getByRole("menuitem", {
      name: /Cambiar Contraseña/i,
    });
    expect(pwdLink).toHaveAttribute("href", "/app/change-password");
  });
});
