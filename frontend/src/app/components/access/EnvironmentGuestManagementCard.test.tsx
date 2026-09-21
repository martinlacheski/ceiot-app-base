import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentGuestManagementCard } from "./EnvironmentGuestManagementCard";

const showConfirmDialogMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const serviceMocks = vi.hoisted(() => ({
  sendInvitation: vi.fn(),
  updateInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  revokeGuestInvitation: vi.fn(),
}));
let inviteError: unknown;

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  useQuery: () => ({
    data: {
      items: [{
        id: "inv-1",
        email: "guest@example.com",
        status: "pending",
        scopeType: "environment",
        commissionRate: 0.125,
        accessStartsAt: "2026-05-27T00:00:00",
      }],
    },
  }),
  useMutation: (config: {
    mutationFn?: (value?: never) => Promise<unknown>;
    onError?: (error: unknown) => void;
    onSuccess?: () => void;
  }) => ({
    isPending: false,
    mutate: async (value?: never) => {
      try {
        if (config.mutationFn?.toString().includes("sendInvitation") && inviteError) {
          const error = inviteError;
          inviteError = undefined;
          throw error;
        }
        const result = await config.mutationFn?.(value);
        config.onSuccess?.();
        return result;
      } catch (error) {
        config.onError?.(error);
      }
    },
    mutateAsync: async (value?: never) => {
      const result = await config.mutationFn?.(value);
      config.onSuccess?.();
      return result;
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (selector: (state: { user: { isAdmin: boolean } }) => unknown) =>
    selector({ user: { isAdmin: false } }),
}));
vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (...args: unknown[]) => showConfirmDialogMock(...args),
}));
vi.mock("@/app/services/environment.service", () => ({
  environmentService: {
    sendInvitation: serviceMocks.sendInvitation,
    updateInvitation: serviceMocks.updateInvitation,
    listInvitations: vi.fn(),
    revokeInvitation: serviceMocks.revokeInvitation,
  },
}));
vi.mock("@/app/services/device.service", () => ({
  deviceService: { revokeGuestInvitation: serviceMocks.revokeGuestInvitation },
}));
vi.mock("@/app/components/access/PendingInvitationEditDialog", () => ({
  PendingInvitationEditDialog: ({ onSave }: { onSave: (payload: { accessStartsAt: string }) => Promise<void> }) => (
    <button onClick={() => void onSave({ accessStartsAt: "2026-05-30T09:15:00" })}>
      Save access date
    </button>
  ),
}));

const environments = [{
  id: "env-1",
  name: "Sucursal Centro",
  address: "Calle 123",
  location: "-31,-64",
  description: "Principal",
  cityId: "city-1",
  typeId: "type-1",
  isActive: true,
  ownerId: "owner-1",
}];

describe("EnvironmentGuestManagementCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteError = undefined;
    serviceMocks.sendInvitation.mockResolvedValue({});
    serviceMocks.updateInvitation.mockResolvedValue({});
    serviceMocks.revokeInvitation.mockResolvedValue({});
    serviceMocks.revokeGuestInvitation.mockResolvedValue({});
  });

  it("keeps the owner-only fallback without commission language", () => {
    render(<EnvironmentGuestManagementCard environments={[]} />);
    expect(screen.getByText(/Solo el propietario puede gestionar/i)).toBeInTheDocument();
    expect(screen.queryByText(/comisi/i)).not.toBeInTheDocument();
  });

  it("shows invitation dates without financial controls or percentages", () => {
    render(<EnvironmentGuestManagementCard environments={environments} />);
    expect(screen.getByText("guest@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Desde 27\/0?5\/2026 00:00/)).toBeInTheDocument();
    expect(screen.queryByText(/comisi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("sends an environment invitation with email and access date only", async () => {
    render(<EnvironmentGuestManagementCard environments={environments} />);
    fireEvent.change(screen.getByLabelText("Correo electrónico del invitado"), {
      target: { value: "guest@example.com" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" })));
    expect(serviceMocks.sendInvitation).toHaveBeenCalledWith("env-1", {
      email: "guest@example.com",
      accessStartsAt: expect.any(String),
    });
  });

  it("updates pending invitations with the access date only", async () => {
    render(<EnvironmentGuestManagementCard environments={environments} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save access date" })));
    expect(serviceMocks.updateInvitation).toHaveBeenCalledWith("env-1", "inv-1", {
      accessStartsAt: "2026-05-30T09:15:00",
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["device-access-context"] });
  });

  it("preserves cross-scope conflict confirmation and retry", async () => {
    inviteError = {
      response: {
        status: 409,
        data: { detail: {
          message: "Conflict",
          conflictScope: "device",
          conflictType: "pending_invitation",
          invitationId: "inv-device",
          deviceId: "device-1",
          deviceName: "Sensor 1",
        } },
      },
    };
    render(<EnvironmentGuestManagementCard environments={environments} />);
    fireEvent.change(screen.getByLabelText("Correo electrónico del invitado"), {
      target: { value: "guest@example.com" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" })));
    const confirm = showConfirmDialogMock.mock.calls[0]?.[1] as () => Promise<void>;
    await act(async () => confirm());
    expect(serviceMocks.revokeGuestInvitation).toHaveBeenCalledWith("device-1", "inv-device");
    expect(serviceMocks.sendInvitation).toHaveBeenCalledWith("env-1", {
      email: "guest@example.com",
      accessStartsAt: expect.any(String),
    });
  });
});
