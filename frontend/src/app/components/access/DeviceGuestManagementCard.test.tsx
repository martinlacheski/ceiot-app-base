import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";
import { DeviceGuestManagementCard } from "./DeviceGuestManagementCard";

const serviceMocks = vi.hoisted(() => ({
  inviteGuestByEmail: vi.fn(),
  deactivateGuestRelation: vi.fn(),
  revokeGuestInvitation: vi.fn(),
}));
const invalidateQueriesMock = vi.fn();
const showConfirmDialogMock = vi.fn();

const accessContext = {
  deviceId: "device-1",
  environmentId: "env-1",
  ownerUserId: "owner-1",
  actorUserId: "owner-1",
  isOwner: true,
  isGuest: false,
  canReadMovements: true,
  canManageGuests: true,
  canOperateDevice: true,
  guests: [
    {
      guestUserId: "guest-1",
      email: "guest1@example.com",
      firstName: "Guest",
      lastName: "One",
      phone: "5492611234567",
      accessStartsAt: "2026-05-27T00:00:00",
      sourceScope: "device",
    },
    {
      guestUserId: "guest-2",
      email: "guest2@example.com",
      firstName: "Guest",
      lastName: "Two",
      accessStartsAt: "2026-05-28T00:00:00",
      sourceScope: "environment",
    },
  ],
  pendingInvitations: [
    {
      id: "invitation-1",
      ownerUserId: "owner-1",
      email: "pending@example.com",
      scopeType: "device",
      scopeId: "device-1",
      accessStartsAt: "2026-05-29T00:00:00.987654321+05:30",
      status: "pending",
      isActive: true,
    },
  ],
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
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  useQuery: () => ({ data: accessContext }),
  useMutation: (config: {
    mutationFn?: (value?: never) => Promise<unknown>;
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  }) => ({
    isPending: false,
    mutateAsync: async (value?: never) => {
      try {
        const result = await config.mutationFn?.(value);
        config.onSuccess?.();
        return result;
      } catch (error) {
        config.onError?.(error);
        throw error;
      }
    },
  }),
}));

vi.mock("@/admin/hooks/useUsers", () => ({
  useUsers: () => ({ data: { items: [] } }),
}));
vi.mock("@/auth/store/auth.store", () => ({
  useAuthStore: (
    selector: (state: { user: { isAdmin: boolean } }) => unknown,
  ) => selector({ user: { isAdmin: false } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/services/device.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/services/device.service")>();
  return {
    deviceService: {
      ...actual.deviceService,
      getAccessContext: vi.fn(),
      inviteGuestByEmail: serviceMocks.inviteGuestByEmail,
      deactivateGuestRelation: serviceMocks.deactivateGuestRelation,
      revokeGuestInvitation: serviceMocks.revokeGuestInvitation,
    },
  };
});
vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (...args: unknown[]) => showConfirmDialogMock(...args),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/custom/DateTimePicker24h", () => ({
  DateTimePicker24h: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: Date;
    onChange: (date: Date) => void;
  }) => (
    <input
      id={id}
      aria-label={
        id === "pending-invitation-access-start"
          ? "Editar acceso desde"
          : "Acceso desde"
      }
      value={value.toISOString().slice(0, 16)}
      onChange={(event) => onChange(new Date(`${event.target.value}:00`))}
    />
  ),
}));

describe("DeviceGuestManagementCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.inviteGuestByEmail.mockResolvedValue({});
    serviceMocks.deactivateGuestRelation.mockResolvedValue({});
    serviceMocks.revokeGuestInvitation.mockResolvedValue({});
  });

  it("hides management UI for non-owners", () => {
    const { container } = render(
      <DeviceGuestManagementCard deviceId="device-1" isOwner={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows both scopes and dates without commission controls or percentages", () => {
    render(<DeviceGuestManagementCard deviceId="device-1" isOwner />);

    expect(screen.getByText("Guest One")).toBeInTheDocument();
    expect(screen.getByText("Guest Two")).toBeInTheDocument();
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/Acceso heredado del establecimiento/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Desasociar" })).toHaveLength(
      1,
    );
    expect(screen.queryByText(/comisi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("enables an invitation with only a valid normalized email and sends its date", async () => {
    render(<DeviceGuestManagementCard deviceId="device-1" isOwner />);
    const button = screen.getByRole("button", { name: "Enviar invitación" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Correo electrónico del invitado"), {
      target: { value: " Guest@Example.com " },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    const confirm = showConfirmDialogMock.mock
      .calls[0]?.[1] as () => Promise<void>;
    await act(async () => confirm());
    expect(serviceMocks.inviteGuestByEmail).toHaveBeenCalledWith("device-1", {
      email: "guest@example.com",
      accessStartsAt: expect.any(String),
    });
  });

  it("composes the device card, real editor, real service, and mocked transport", async () => {
    const originalTimestamp = "2026-05-29T00:00:00.987654321+05:30";
    vi.mocked(appApi.patch).mockResolvedValue({
      data: {
        id: "invitation-1",
        owner_user_id: "owner-1",
        email: "pending@example.com",
        scope_type: "device",
        scope_id: "device-1",
        access_starts_at: originalTimestamp,
        status: "pending",
        is_active: true,
      },
    });

    render(<DeviceGuestManagementCard deviceId="device-1" isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const confirm = showConfirmDialogMock.mock
      .calls[0]?.[1] as () => Promise<void>;
    await act(async () => confirm());

    expect(appApi.patch).toHaveBeenCalledWith(
      "/devices/device-1/guest-invitations/invitation-1",
      { access_starts_at: originalTimestamp },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["device-access-context", "device-1"],
    });
  });

  it("preserves confirmation before revoking a direct invitation", async () => {
    render(<DeviceGuestManagementCard deviceId="device-1" isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Revocar" }));
    expect(serviceMocks.revokeGuestInvitation).not.toHaveBeenCalled();
    const confirm = showConfirmDialogMock.mock
      .calls[0]?.[1] as () => Promise<void>;
    await act(async () => confirm());
    expect(serviceMocks.revokeGuestInvitation).toHaveBeenCalledWith(
      "device-1",
      "invitation-1",
    );
  });
});
