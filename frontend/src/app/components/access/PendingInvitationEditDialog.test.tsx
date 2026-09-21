import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingInvitationEditDialog } from "./PendingInvitationEditDialog";

const showConfirmDialogMock = vi.fn();

vi.mock("@/store/confirm.store", () => ({
  showConfirmDialog: (...args: unknown[]) => showConfirmDialogMock(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/custom/DateTimePicker24h", () => ({
  DateTimePicker24h: ({ id, value, onChange }: { id: string; value: Date; onChange: (date: Date) => void }) => (
    <input
      id={id}
      aria-label="Acceso desde"
      value={value.toISOString().slice(0, 16)}
      onChange={(event) => onChange(new Date(`${event.target.value}:00`))}
    />
  ),
}));

describe("PendingInvitationEditDialog", () => {
  beforeEach(() => showConfirmDialogMock.mockReset());

  it("edits only the access start and never renders commission controls", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <PendingInvitationEditDialog
        open
        email="guest@example.com"
        accessStartsAt="2026-05-27T10:00:00Z"
        isSaving={false}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    expect(screen.queryByText(/comisi/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Acceso desde"), {
      target: { value: "2026-05-28T14:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const confirm = showConfirmDialogMock.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;
    expect(confirm).toEqual(expect.any(Function));
    await act(async () => confirm?.());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ accessStartsAt: "2026-05-28T14:30:00" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("preserves an unchanged valid timestamp byte-for-byte", async () => {
    const originalTimestamp = "2026-05-27T10:00:00.123456789-03:00";
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <PendingInvitationEditDialog
        open
        email="guest@example.com"
        accessStartsAt={originalTimestamp}
        isSaving={false}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const confirm = showConfirmDialogMock.mock.calls[0]?.[1] as () => Promise<void>;
    await act(async () => confirm());

    expect(onSave).toHaveBeenCalledWith({ accessStartsAt: originalTimestamp });
  });

  it("keeps the dialog open when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("save failed"));
    const onOpenChange = vi.fn();

    render(
      <PendingInvitationEditDialog
        open
        email="guest@example.com"
        accessStartsAt="2026-05-27T10:00:00Z"
        isSaving={false}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const confirm = showConfirmDialogMock.mock.calls[0]?.[1] as () => Promise<void>;
    await expect(confirm()).rejects.toThrow("save failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and prevents duplicate submission while saving", () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PendingInvitationEditDialog
        open
        email="guest@example.com"
        accessStartsAt="2026-05-27T10:00:00Z"
        isSaving
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
