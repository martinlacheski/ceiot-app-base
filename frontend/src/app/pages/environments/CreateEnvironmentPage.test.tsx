import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";
import { CreateEnvironmentPage } from "./CreateEnvironmentPage";

const showConfirmDialogMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const serviceMocks = vi.hoisted(() => ({
  sendInvitation: vi.fn(),
  revokeGuestInvitation: vi.fn(),
  updateEnvironment: vi.fn(),
}));
const environmentFormPropsRef = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const queryState = vi.hoisted(() => ({
  invitations: [] as Array<Record<string, unknown>>,
  userId: "owner-1",
  isAdmin: false,
}));

const originalTimestamp = "2026-05-27T10:00:00.123456789-03:00";
const pendingInvitation = {
  id: "inv-1",
  email: "pending@example.com",
  firstName: null,
  lastName: null,
  status: "pending",
  scopeType: "environment",
  environmentId: "env-1",
  ownerId: "owner-1",
  accessStartsAt: originalTimestamp,
  isActive: true,
};

const conflictError = {
  response: {
    status: 409,
    data: {
      detail: {
        message: "El usuario ya tiene acceso activo a un dispositivo de este establecimiento.",
        conflictScope: "device",
        conflictType: "active_relation",
        invitationId: "accepted-invitation-77",
        deviceId: "device-77",
        deviceName: "Kiosco 1",
        deviceSerial: "IOT-00077",
      },
    },
  },
};

vi.mock("@/api/appApi", () => ({
  appApi: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));
vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "env-1" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "environment") {
      return {
        data: {
          id: "env-1",
          name: "Sucursal Centro",
          address: "Calle 123",
          location: "-31,-64",
          description: "Principal",
          cityId: "city-1",
          typeId: "type-1",
          isActive: true,
          ownerId: "owner-1",
          mpCountryId: "legacy-country",
          mpStateId: "legacy-state",
          mpCityId: "legacy-city",
          mpStoreStatus: "failed",
          mpStoreLastError: "legacy failure",
        },
        isLoading: false,
      };
    }
    return { data: { items: queryState.invitations }, isLoading: false };
  },
  useMutation: (config: {
    mutationFn?: (value?: unknown) => Promise<unknown>;
    onError?: (error: unknown) => void;
    onSuccess?: (value?: unknown) => void;
  }) => ({
    isPending: false,
    mutateAsync: async (value?: unknown) => {
      try {
        const result = await config.mutationFn?.(value);
        config.onSuccess?.(result);
        return result;
      } catch (error) {
        config.onError?.(error);
        throw error;
      }
    },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: { id: string; isAdmin: boolean } }) => unknown) =>
    selector({ user: { id: queryState.userId, isAdmin: queryState.isAdmin } }),
}));
vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (...args: unknown[]) => showConfirmDialogMock(...args),
}));
vi.mock("@/app/services/environment.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/services/environment.service")>();
  return {
    environmentService: {
      ...actual.environmentService,
      sendInvitation: serviceMocks.sendInvitation,
      update: serviceMocks.updateEnvironment,
      create: vi.fn(),
      revokeInvitation: vi.fn(),
    },
  };
});
vi.mock("@/app/services/device.service", () => ({
  deviceService: { revokeGuestInvitation: serviceMocks.revokeGuestInvitation },
}));
vi.mock("@/app/components/environments/EnvironmentForm", () => ({
  EnvironmentForm: (props: {
    afterDescriptionContent?: ReactNode;
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
  }) => {
    environmentFormPropsRef.current = props as unknown as Record<string, unknown>;
    return (
      <div>
        <button
          type="button"
          onClick={() => void props.onSubmit({
            name: "Sucursal Centro",
            address: "Calle 123",
            location: "-31,-64",
            description: "Principal actualizada",
            cityId: "city-1",
            typeId: "type-1",
            isActive: true,
          })}
        >
          Submit environment
        </button>
        {props.afterDescriptionContent}
      </div>
    );
  },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/custom/DateTimePicker24h", () => ({
  DateTimePicker24h: ({ id, value, onChange }: { id: string; value: Date; onChange: (date: Date) => void }) => (
    <input
      id={id}
      aria-label={id === "pending-invitation-access-start" ? "Editar acceso desde" : "Acceso desde"}
      value={value.toISOString().slice(0, 16)}
      onChange={(event) => onChange(new Date(`${event.target.value}:00`))}
    />
  ),
}));

describe("CreateEnvironmentPage guest invitation management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.invitations = [{ ...pendingInvitation }];
    queryState.userId = "owner-1";
    queryState.isAdmin = false;
    serviceMocks.sendInvitation.mockRejectedValueOnce(conflictError).mockResolvedValue({});
    serviceMocks.revokeGuestInvitation.mockResolvedValue({});
    serviceMocks.updateEnvironment.mockResolvedValue({ id: "env-1" });
    environmentFormPropsRef.current = {};
  });

  it("confirms revoking an active device relation and retries the environment invitation", async () => {
    render(<CreateEnvironmentPage />);
    fireEvent.change(screen.getByLabelText("Correo electrónico del invitado"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    const submitInvitation = showConfirmDialogMock.mock.calls[0][1] as () => Promise<void>;
    await act(async () => submitInvitation());
    const resolveConflict = showConfirmDialogMock.mock.calls[1][1] as () => Promise<void>;
    await act(async () => resolveConflict());

    expect(serviceMocks.revokeGuestInvitation).toHaveBeenCalledWith("device-77", "accepted-invitation-77");
    expect(serviceMocks.sendInvitation).toHaveBeenLastCalledWith("env-1", {
      email: "guest@example.com",
      accessStartsAt: expect.any(String),
    });
  });

  it("composes the live page, real editor, real service, and mocked transport", async () => {
    vi.mocked(appApi.patch).mockResolvedValue({ data: {
      id: "inv-1",
      email: "pending@example.com",
      status: "pending",
      scope_type: "environment",
      scope_id: "env-1",
      owner_user_id: "owner-1",
      access_starts_at: originalTimestamp,
      is_active: true,
    } });

    render(<CreateEnvironmentPage />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const confirm = showConfirmDialogMock.mock.calls[0][1] as () => Promise<void>;
    await act(async () => confirm());

    expect(appApi.patch).toHaveBeenCalledWith(
      "/access/scopes/environment/env-1/guest-invitations/inv-1",
      { access_starts_at: originalTimestamp },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["environment-guest-invitations", "env-1"],
    });
  });

  it("retains the editor and exact date after failure, then permits retry", async () => {
    vi.mocked(appApi.patch)
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce({ data: {
        id: "inv-1",
        email: "pending@example.com",
        status: "pending",
        scope_type: "environment",
        scope_id: "env-1",
        owner_user_id: "owner-1",
        access_starts_at: originalTimestamp,
        is_active: true,
      } });

    render(<CreateEnvironmentPage />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const firstConfirm = showConfirmDialogMock.mock.calls[0][1] as () => Promise<void>;
    await expect(firstConfirm()).rejects.toThrow("save failed");

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const retryConfirm = showConfirmDialogMock.mock.calls[1][1] as () => Promise<void>;
    await act(async () => retryConfirm());

    expect(appApi.patch).toHaveBeenCalledTimes(2);
    expect(appApi.patch).toHaveBeenLastCalledWith(
      "/access/scopes/environment/env-1/guest-invitations/inv-1",
      { access_starts_at: originalTimestamp },
    );
  });

  it("strips historical Mercado Pago metadata from edit defaults and update payloads", async () => {
    render(<CreateEnvironmentPage />);

    const defaultValues = environmentFormPropsRef.current.defaultValues as Record<string, unknown>;
    expect(Object.keys(defaultValues).some((key) => key.startsWith("mp"))).toBe(false);

    await act(async () => {
      screen.getByRole("button", { name: "Submit environment" }).click();
    });

    expect(serviceMocks.updateEnvironment).toHaveBeenCalledWith("env-1", {
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-31,-64",
      description: "Principal actualizada",
      cityId: "city-1",
      typeId: "type-1",
      isActive: true,
    });
  });

  it("does not expose invitation management to a non-owner", () => {
    queryState.userId = "other-user";
    render(<CreateEnvironmentPage />);
    expect(screen.queryByRole("button", { name: "Gestionar invitados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("does not offer editing for accepted or inactive invitations", () => {
    queryState.invitations = [
      { ...pendingInvitation, status: "accepted" },
      { ...pendingInvitation, id: "inv-2", email: "inactive@example.com", isActive: false },
    ];
    render(<CreateEnvironmentPage />);
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });
});
