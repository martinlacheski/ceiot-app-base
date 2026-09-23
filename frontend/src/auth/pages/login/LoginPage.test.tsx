import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { appApi } from "@/api/appApi";
import { useAuthStore } from "@/auth/store/auth.store";
import { ConfirmDialog } from "@/components/custom/ConfirmDialog";
import { useConfirmStore } from "@/store/confirm.store";
import { LoginPage } from "./LoginPage";

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      resendVerificationEmail: vi.fn(),
      token: null,
    })),
  }),
}));

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/apiBaseUrl", () => ({
  API_BASE_URL: "http://localhost:8100/api",
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("LoginPage", () => {
  const mockLogin = vi.fn();
  const mockLoginWithToken = vi.fn();
  const providerGet = vi.mocked(appApi.get);

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    useConfirmStore.setState({ isOpen: false });
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      login: mockLogin,
      loginWithToken: mockLoginWithToken,
      message: null,
      error: null,
    });
  });

  const renderComponent = (initialEntries = ["/auth/login"]) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/auth/login" element={<LoginPage />} />
            <Route path="/invitations/accept" element={<div>Invitation Page</div>} />
          </Routes>
          <ConfirmDialog />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  const replaceLocation = () => {
    const originalLocation = window.location;
    const mockLocation = {
      href: "",
      assign: vi.fn((url: string) => {
        mockLocation.href = url;
      }),
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: mockLocation,
    });
    return () => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    };
  };

  it("renders the login form and Google option without checking providers on mount", () => {
    renderComponent();
    expect(screen.getByText("Ingrese a nuestra aplicación")).toBeInTheDocument();
    expect(screen.getByLabelText("Usuario")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByText("O ingresa con")).toBeInTheDocument();
    expect(providerGet).not.toHaveBeenCalled();
    const logo = screen.getByRole("img", { name: /monitoreo ambiental iot/i });
    expect(logo.parentElement).toHaveClass("size-24");
    expect(logo.parentElement).not.toHaveClass("bg-white");
    // The back link is rendered once by AuthLayout, not by the page itself.
    expect(screen.queryByRole("link", { name: /Volver al inicio/i })).not.toBeInTheDocument();
  });

  it("calls login on submit", async () => {
    mockLogin.mockResolvedValue({ success: false });
    renderComponent();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password" } });
    const submitBtn = screen.getByRole("button", { name: "Ingresar" });
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("testuser", "password"));
  });

  it("navigates to Google only for a strict true capability and preserves encoded next", async () => {
    const restoreLocation = replaceLocation();
    providerGet.mockResolvedValue({ data: { google: true } });
    renderComponent(["/auth/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"]);

    await userEvent.click(screen.getByRole("button", { name: "Google" }));

    await waitFor(() => expect(window.location.href).toBe(
      "http://localhost:8100/api/auth/google/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1",
    ));
    expect(window.sessionStorage.getItem("auth:returnTo")).toBe("/invitations/accept?id=inv-1");
    restoreLocation();
  });

  it("shows concise Google access guidance when capability is false despite legacy data", async () => {
    const restoreLocation = replaceLocation();
    providerGet.mockResolvedValue({
      data: { google: false, clientId: "legacy-value-that-must-not-enable" },
    });
    renderComponent(["/auth/login?next=%2Finvitations%2Faccept"]);

    const googleButton = screen.getByRole("button", { name: "Google" });
    expect(googleButton).toBeVisible();
    await userEvent.click(googleButton);

    expect(await screen.findByRole("heading", { name: "Acceso con Google" })).toBeInTheDocument();
    const setupDialog = screen.getByRole("alertdialog");
    expect(setupDialog).toHaveTextContent(
      "Esta opción todavía no está configurada. Por ahora, ingresá con tu usuario y contraseña.",
    );
    expect(setupDialog).not.toHaveTextContent(/Google Cloud|OAuth|GOOGLE_OAUTH_SETUP\.md|operador|guarda tu contraseña/i);
    expect(window.location.href).toBe("");
    expect(window.sessionStorage.getItem("auth:returnTo")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("heading", { name: "Acceso con Google" })).not.toBeInTheDocument();
    restoreLocation();
  });

  it.each([
    ["malformed", () => Promise.resolve({ data: { google: "true" } })],
    ["network failure", () => Promise.reject(new Error("offline"))],
  ])("shows an honest verification failure for %s without redirecting", async (_case, result) => {
    const restoreLocation = replaceLocation();
    providerGet.mockImplementation(result);
    renderComponent(["/auth/login?next=%2Finvitations%2Faccept"]);

    await userEvent.click(screen.getByRole("button", { name: "Google" }));

    expect(await screen.findByRole("heading", { name: "No se pudo verificar Google" })).toBeInTheDocument();
    expect(screen.getByText(/no pudimos verificar si el acceso con Google está disponible/i)).toBeInTheDocument();
    expect(window.location.href).toBe("");
    expect(window.sessionStorage.getItem("auth:returnTo")).toBeNull();
    restoreLocation();
  });

  it("prevents duplicate provider checks while one is pending", async () => {
    let resolveRequest!: (value: { data: { google: boolean } }) => void;
    providerGet.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    renderComponent();
    const googleButton = screen.getByRole("button", { name: "Google" });

    fireEvent.click(googleButton);
    fireEvent.click(googleButton);

    expect(providerGet).toHaveBeenCalledTimes(1);
    expect(googleButton).toBeDisabled();
    resolveRequest({ data: { google: false } });
    expect(await screen.findByRole("button", { name: "Entendido" })).toBeInTheDocument();
  });

  it("opens the forgot password dialog", () => {
    renderComponent();
    fireEvent.click(screen.getByText("¿Olvidaste tu contraseña?"));
    expect(screen.getByText("Recuperar contraseña")).toBeInTheDocument();
  });

  it("redirects to the next query param after password login", async () => {
    mockLogin.mockResolvedValue({ success: true });
    renderComponent(["/auth/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"]);
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Invitation Page")).toBeInTheDocument();
  });

  it("redirects to the stored invitation return path after password login", async () => {
    window.sessionStorage.setItem("auth:returnTo", "/invitations/accept?id=inv-1");
    mockLogin.mockResolvedValue({ success: true });
    renderComponent();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Invitation Page")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("auth:returnTo")).toBeNull();
  });
});
