import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createDefaultAccessStart,
  formatAccessStartLabel,
  toLocalDateTimePayload,
} from "@/app/components/access/accessStart.utils";
import { PendingInvitationEditDialog } from "@/app/components/access/PendingInvitationEditDialog";
import { environmentService } from "@/app/services/environment.service";
import { deviceService } from "@/app/services/device.service";
import { SCOPE_TYPE, type EnvironmentInvitation } from "@/app/types/access.types";
import type { Environment } from "@/app/types/environment.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimePicker24h } from "@/components/custom/DateTimePicker24h";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showConfirmDialog } from "@/store/confirm.store";
import { getInvitationStatusLabel } from "@/utils/status-labels";

interface DeviceConflictDetail {
  message?: string;
  conflictScope?: string;
  conflictType?: string;
  invitationId?: string;
  deviceId?: string;
  deviceName?: string | null;
  deviceSerial?: string | null;
}

const getErrorDetail = (error: unknown, fallback: string) => {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && "message" in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
};

const getDeviceConflictDetail = (error: unknown): DeviceConflictDetail | null => {
  if (typeof error !== "object" || error === null || !("response" in error)) return null;
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
  const detail = response?.data?.detail;
  if (response?.status !== 409 || typeof detail !== "object" || detail === null) return null;
  const conflict = detail as DeviceConflictDetail;
  if (
    conflict.conflictScope !== "device" ||
    !["pending_invitation", "active_relation"].includes(conflict.conflictType ?? "") ||
    typeof conflict.invitationId !== "string" ||
    typeof conflict.deviceId !== "string"
  ) return null;
  return conflict;
};

export function EnvironmentGuestManagementCard({ environments }: { environments: Environment[] }) {
  const queryClient = useQueryClient();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [invitationEmail, setInvitationEmail] = useState("");
  const [accessStartDate, setAccessStartDate] = useState<Date>(createDefaultAccessStart);
  const [editingInvitation, setEditingInvitation] = useState<EnvironmentInvitation | null>(null);
  const activeEnvironmentId = selectedEnvironmentId && environments.some((item) => item.id === selectedEnvironmentId)
    ? selectedEnvironmentId
    : environments[0]?.id ?? "";
  const selectedEnvironment = environments.find((item) => item.id === activeEnvironmentId);

  const { data: invitationsData } = useQuery({
    queryKey: ["environment-guest-invitations", activeEnvironmentId],
    queryFn: () => environmentService.listInvitations(activeEnvironmentId, { page: 1, perPage: 20 }),
    enabled: !!activeEnvironmentId,
  });

  const invalidateAccess = () => {
    queryClient.invalidateQueries({ queryKey: ["environment-guest-invitations", activeEnvironmentId] });
    queryClient.invalidateQueries({ queryKey: ["device-access-context"] });
  };

  const inviteMutation = useMutation({
    mutationFn: () => environmentService.sendInvitation(activeEnvironmentId, {
      email: invitationEmail.trim().toLowerCase(),
      accessStartsAt: toLocalDateTimePayload(accessStartDate),
    }),
    onSuccess: () => {
      toast.success("Invitación enviada");
      setInvitationEmail("");
      setAccessStartDate(createDefaultAccessStart());
      invalidateAccess();
    },
    onError: (error: unknown) => {
      const conflict = getDeviceConflictDetail(error);
      if (!conflict) {
        toast.error(getErrorDetail(error, "No se pudo enviar la invitación"));
        return;
      }
      const label = conflict.deviceName || conflict.deviceSerial || "ese dispositivo";
      const message = conflict.conflictType === "active_relation"
        ? `El usuario ya tiene acceso al dispositivo ${label}. ¿Querés revocarlo y enviar la invitación al establecimiento?`
        : `Ya existe una invitación pendiente para este correo electrónico en el dispositivo ${label}. ¿Querés revocarla y enviar la invitación al establecimiento?`;
      showConfirmDialog(message, async () => {
        try {
          await deviceService.revokeGuestInvitation(conflict.deviceId!, conflict.invitationId!);
          await inviteMutation.mutateAsync();
        } catch {
          toast.error("No se pudo completar el cambio de alcance");
        }
      });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => environmentService.revokeInvitation(activeEnvironmentId, id),
    onSuccess: () => { toast.success("Invitación revocada"); invalidateAccess(); },
    onError: () => toast.error("No se pudo revocar la invitación"),
  });
  const updateInvitationMutation = useMutation({
    mutationFn: (payload: { invitationId: string; accessStartsAt: string }) =>
      environmentService.updateInvitation(activeEnvironmentId, payload.invitationId, { accessStartsAt: payload.accessStartsAt }),
    onSuccess: () => { toast.success("Invitación actualizada"); invalidateAccess(); },
    onError: (error: unknown) => toast.error(getErrorDetail(error, "No se pudo actualizar la invitación")),
  });

  if (environments.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Invitados por establecimiento</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Solo el propietario puede gestionar invitados.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Invitados por establecimiento</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="environment-owner-selector">Establecimiento</Label>
          <select id="environment-owner-selector" className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm" value={activeEnvironmentId} onChange={(event) => setSelectedEnvironmentId(event.target.value)}>
            {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
          </select>
        </div>
        <div className="space-y-2 rounded-md border p-4">
          <h3 className="font-medium">Invitados</h3>
          <Label htmlFor="environment-guest-email">Correo electrónico del invitado</Label>
          <Input id="environment-guest-email" type="email" placeholder="Ingresá el correo electrónico" value={invitationEmail} onChange={(event) => setInvitationEmail(event.target.value)} />
          <Label htmlFor="environment-guest-access-start">Acceso desde</Label>
          <DateTimePicker24h id="environment-guest-access-start" value={accessStartDate} onChange={(date) => setAccessStartDate(date ?? createDefaultAccessStart())} />
          <Button onClick={() => inviteMutation.mutate()} disabled={!activeEnvironmentId || invitationEmail.trim() === "" || inviteMutation.isPending}>Enviar invitación</Button>
        </div>
        <div className="space-y-2 rounded-md border p-4">
          <h3 className="font-medium">Invitaciones pendientes {selectedEnvironment ? `· ${selectedEnvironment.name}` : ""}</h3>
          {(invitationsData?.items ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p> : null}
          {(invitationsData?.items ?? []).map((invitation) => {
            const canEdit = invitation.scopeType === SCOPE_TYPE.ENVIRONMENT && invitation.status.toLowerCase() === "pending";
            return (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">Estado: {getInvitationStatusLabel(invitation.status)}</p>
                  <p className="text-xs text-muted-foreground">{formatAccessStartLabel(invitation.accessStartsAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit ? <Button variant="secondary" onClick={() => setEditingInvitation(invitation)} disabled={updateInvitationMutation.isPending}>Editar</Button> : null}
                  <Button variant="outline" onClick={() => revokeMutation.mutate(invitation.id)} disabled={revokeMutation.isPending}>Revocar</Button>
                </div>
              </div>
            );
          })}
          {editingInvitation ? (
            <PendingInvitationEditDialog
              open
              email={editingInvitation.email}
              accessStartsAt={editingInvitation.accessStartsAt}
              isSaving={updateInvitationMutation.isPending}
              onOpenChange={(open) => { if (!open) setEditingInvitation(null); }}
              onSave={(payload) => updateInvitationMutation.mutateAsync({ invitationId: editingInvitation.id, accessStartsAt: payload.accessStartsAt }).then(() => undefined)}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
