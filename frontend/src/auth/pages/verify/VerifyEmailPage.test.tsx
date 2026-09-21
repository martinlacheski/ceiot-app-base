import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerifyEmailPage } from "./VerifyEmailPage";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { appApi } from "@/api/appApi";
import { AxiosError } from "axios";

// Mock api
vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
  },
}));

// Create a new QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

const renderComponent = (token?: string) => {
  const path = token ? `/verify-email?token=${token}` : "/verify-email";
  const client = createTestQueryClient();

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show error if no token is provided", () => {
    renderComponent();
    expect(screen.getByText("Token no proporcionado")).toBeInTheDocument();
  });

  it("should show loading state initially", () => {
    // Mock pending promise
    vi.mocked(appApi.get).mockReturnValue(new Promise(() => {}));

    renderComponent("validtoken");
    expect(screen.getByText("Verificando tu correo...")).toBeInTheDocument();
  });

  it("should show success message when verification succeeds", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { message: "Success" } });

    renderComponent("validtoken");

    await waitFor(() => {
      expect(screen.getByText("¡Correo verificado!")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Tu cuenta ha sido activada correctamente.")
    ).toBeInTheDocument();
  });

  it("should show error message when verification fails", async () => {
    const error = new AxiosError("Error");
    error.response = {
      data: {
        detail: "Token inválido o expirado",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    vi.mocked(appApi.get).mockRejectedValue(error);

    renderComponent("invalidtoken");

    await waitFor(() => {
      expect(screen.getByText("Error de verificación")).toBeInTheDocument();
    });
    expect(screen.getByText("Token inválido o expirado")).toBeInTheDocument();
  });
});
