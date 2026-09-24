import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PairDevicePage from "./PairDevicePage";

const mutateMock = vi.fn();

vi.mock("@/app/hooks/useDevices", () => ({
  usePairDevice: () => ({
    isPending: false,
    mutate: mutateMock,
  }),
}));

vi.mock("@/app/hooks/useEnvironments", () => ({
  useEnvironments: () => ({
    isLoading: false,
    data: {
      items: [
        {
          id: "env-1",
          name: "Establecimiento Centro",
          ownerId: "owner-1",
        },
      ],
    },
  }),
  useCreateEnvironment: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: () => ({
    user: { id: "owner-1" },
  }),
}));

vi.mock("@/app/services/device.service", () => ({
  deviceService: {
    checkSerial: vi.fn().mockResolvedValue({
      message: "Dispositivo disponible",
      status: "available",
    }),
  },
}));

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (_message: string, onConfirm: () => void) => onConfirm(),
}));

vi.mock("@/components/custom/SearchableSelect", () => ({
  SearchableSelect: ({
    disabled,
    onChange,
    options,
    placeholder,
    value,
  }: {
    disabled?: boolean;
    onChange: (value: string | undefined) => void;
    options: Array<{ label: string; value: string }>;
    placeholder?: string;
    value?: string;
  }) => (
    <select
      aria-label={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || undefined)}
      value={value ?? ""}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

// EnvironmentForm depends on Google Maps (@vis.gl/react-google-maps) and
// several location queries, so it is stubbed here; the "Nuevo establecimiento"
// dialog and its full form are covered by
// EnvironmentForm.test.tsx / CreateEnvironmentPage.test.tsx already.
vi.mock("@/app/components/environments/EnvironmentForm", () => ({
  EnvironmentForm: () => <div data-testid="environment-form-stub" />,
}));

describe("PairDevicePage", () => {
  beforeEach(() => {
    mutateMock.mockClear();
  });

  it("submits the exact non-financial pairing contract", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PairDevicePage />
      </MemoryRouter>,
    );
    await user.type(screen.getByPlaceholderText("IOT-XXXX-XXXX"), "IOT-1234-5678");
    await user.type(
      screen.getByPlaceholderText("Ej: Agua caliente, Café, Lavado"),
      "Agua caliente",
    );

    expect(screen.queryByLabelText(/importe/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/tiempo de suministro/i)).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/seleccionar establecimiento/i),
      "env-1",
    );

    const submitButton = screen.getByRole("button", { name: /^asociar$/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        {
          serial: "IOT-1234-5678",
          environmentId: "env-1",
          description: "Agua caliente",
        },
        expect.any(Object),
      );
    });
  });

  it("uses noValidate and lets the user submit an empty form to see custom messages", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PairDevicePage />
      </MemoryRouter>,
    );

    const form = document.querySelector("form");
    expect(form).toHaveAttribute("novalidate");

    const submitButton = screen.getByRole("button", { name: /^asociar$/i });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);

    expect(
      await screen.findByText("El nombre del servicio es requerido"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Debe seleccionar un establecimiento"),
    ).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("opens the inline environment creation dialog", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PairDevicePage />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: /nuevo establecimiento/i }),
    );

    expect(await screen.findByText("Nuevo Establecimiento")).toBeInTheDocument();
    expect(screen.getByTestId("environment-form-stub")).toBeInTheDocument();
  });
});
