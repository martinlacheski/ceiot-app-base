import { useState } from "react";

import {
  createDefaultAccessStart,
  toLocalDateTimePayload,
} from "@/app/components/access/accessStart.utils";
import { Button } from "@/components/ui/button";
import { DateTimePicker24h } from "@/components/custom/DateTimePicker24h";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { showConfirmDialog } from "@/store/confirm.store";

interface PendingInvitationEditDialogProps {
  open: boolean;
  email: string;
  accessStartsAt?: string;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: { accessStartsAt: string }) => Promise<void>;
}

const dateFromAccessStart = (value?: string) => {
  if (!value) return createDefaultAccessStart();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? createDefaultAccessStart() : date;
};

export function PendingInvitationEditDialog({
  open,
  email,
  accessStartsAt,
  isSaving,
  onOpenChange,
  onSave,
}: PendingInvitationEditDialogProps) {
  const [accessStartDate, setAccessStartDate] = useState<Date>(() =>
    dateFromAccessStart(accessStartsAt),
  );
  const [originalAccessStart] = useState<string | null>(() => {
    if (!accessStartsAt) return null;
    return Number.isNaN(new Date(accessStartsAt).getTime()) ? null : accessStartsAt;
  });
  const [hasChangedAccessStart, setHasChangedAccessStart] = useState(false);

  const handleSave = () => {
    if (isSaving) return;

    showConfirmDialog(
      `¿Querés guardar los cambios de la invitación a ${email}?`,
      async () => {
        await onSave({
          accessStartsAt:
            !hasChangedAccessStart && originalAccessStart
              ? originalAccessStart
              : toLocalDateTimePayload(accessStartDate),
        });
        onOpenChange(false);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar invitación pendiente</DialogTitle>
          <DialogDescription>
            Actualizá la fecha de acceso para {email}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="pending-invitation-access-start">Acceso desde</Label>
          <DateTimePicker24h
            id="pending-invitation-access-start"
            value={accessStartDate}
            onChange={(date) => {
              setHasChangedAccessStart(true);
              setAccessStartDate(date ?? dateFromAccessStart(accessStartsAt));
            }}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
