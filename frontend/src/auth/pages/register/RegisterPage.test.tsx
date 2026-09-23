import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";

import { RegisterPage } from "./RegisterPage";

const registerUser = vi.fn();

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: vi.fn(() => ({
    registerUser,
    checkUsernameAvailability: vi.fn().mockResolvedValue(true),
    checkEmailAvailability: vi.fn().mockResolvedValue(true),
    checkIdentificationAvailability: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: vi.fn((_: string, onConfirm: () => Promise<void>) => {
    void onConfirm();
  }),
}));

vi.mock("@/lib/apiBaseUrl", () => ({
  API_BASE_URL: "http://localhost:8100/api",
}));

vi.mock("@/components/custom/SmartDatePicker", () => ({
  SmartDatePicker: ({ onChange }: { onChange: (date?: Date) => void }) => (
    <button type="button" onClick={() => onChange(new Date("1990-01-01"))}>
      Seleccionar fecha
    </button>
  ),
}));

vi.mock("@/components/custom/SmartPhoneInput", () => ({
  SmartPhoneInput: ({ onChange }: { onChange: (value: string) => void }) => (
    <input
      aria-label="Teléfono"
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("RegisterPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    registerUser.mockReset();
    registerUser.mockResolvedValue(true);
  });

  it("keeps the invitation redirect after successful registration", async () => {
    render(
      <MemoryRouter
        initialEntries={["/auth/register?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"]}
      >
        <RegisterPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/nombre de usuario/i), {
      target: { value: "guestuser" },
    });
    fireEvent.change(screen.getByLabelText(/nombres/i), {
      target: { value: "Guest" },
    });
    fireEvent.change(screen.getByLabelText(/apellidos/i), {
      target: { value: "User" },
    });
    fireEvent.change(screen.getByLabelText(/número de documento/i), {
      target: { value: "12345678" },
    });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /seleccionar fecha/i }));
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), {
      target: { value: "Password1" },
    });
    fireEvent.change(screen.getByLabelText(/confirmar contraseña/i), {
      target: { value: "Password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    await waitFor(() => {
      expect(registerUser).toHaveBeenCalled();
    });

    expect(
      await screen.findByRole("link", {
        name: /ir al login para aceptar la invitación/i,
      })
    ).toHaveAttribute(
      "href",
      "/auth/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"
    );
  });

  it("keeps the default login CTA when no redirect was provided", () => {
    render(
      <MemoryRouter initialEntries={["/auth/register"]}>
        <RegisterPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /ingresa ahora/i })).toHaveAttribute(
      "href",
      "/auth/login"
    );
  });

  it("shows the product title above the icon-only logo", () => {
    render(
      <MemoryRouter initialEntries={["/auth/register"]}>
        <RegisterPage />
      </MemoryRouter>
    );

    const title = screen.getByRole("heading", { level: 1, name: "Monitoreo Ambiental IoT" });
    const logo = screen.getByRole("img", { name: /monitoreo ambiental iot/i });
    expect(title.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links the consent notice to the landing privacy policy only", () => {
    render(
      <MemoryRouter initialEntries={["/auth/register"]}>
        <RegisterPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "política de privacidad" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/privacidad\/$/)
    );
    expect(screen.queryByText(/términos y condiciones/i)).not.toBeInTheDocument();
  });

  it("passes invitation next path to social registration", () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });

    render(
      <MemoryRouter
        initialEntries={["/auth/register?next=%2Finvitations%2Faccept%3Fid%3Dinv-1"]}
      >
        <RegisterPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Google"));

    expect(window.location.href).toBe(
      "http://localhost:8100/api/auth/google/login?next=%2Finvitations%2Faccept%3Fid%3Dinv-1",
    );
    expect(window.sessionStorage.getItem("auth:returnTo")).toBe(
      "/invitations/accept?id=inv-1",
    );

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
