import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog";
import { useAuthStore } from "@/auth/store/auth.store";
import { toast } from "sonner";

// Mock store
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ForgotPasswordDialog", () => {
  const mockForgotPassword = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      forgotPassword: mockForgotPassword,
    });
  });

  it("should not render when open is false", () => {
    render(
      <ForgotPasswordDialog open={false} onOpenChange={mockOnOpenChange} />
    );
    expect(screen.queryByText("Recuperar contraseña")).not.toBeInTheDocument();
  });

  it("should render when open is true", () => {
    render(
      <ForgotPasswordDialog open={true} onOpenChange={mockOnOpenChange} />
    );
    expect(screen.getByText("Recuperar contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
  });

  it("should call forgotPassword and show success toast on success", async () => {
    mockForgotPassword.mockResolvedValue(true);
    render(
      <ForgotPasswordDialog open={true} onOpenChange={mockOnOpenChange} />
    );

    const emailInput = screen.getByLabelText("Correo electrónico");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitBtn = screen.getByRole("button", { name: "Enviar enlace" });
    fireEvent.click(submitBtn);

    expect(mockForgotPassword).toHaveBeenCalledWith("test@example.com");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("should show error toast on failure", async () => {
    mockForgotPassword.mockResolvedValue(false);
    render(
      <ForgotPasswordDialog open={true} onOpenChange={mockOnOpenChange} />
    );

    const emailInput = screen.getByLabelText("Correo electrónico");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitBtn = screen.getByRole("button", { name: "Enviar enlace" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
      expect(mockOnOpenChange).not.toHaveBeenCalled();
    });
  });
});
