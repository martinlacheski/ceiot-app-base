import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deviceService } from "@/app/services/device.service";
import { SCOPE_TYPE, type DeviceAccessContext } from "@/app/types/access.types";
import { useUsers } from "@/admin/hooks/useUsers";
import {
  createDefaultAccessStart,
  formatAccessStartLabel,
  toLocalDateTimePayload,
} from "@/app/components/access/accessStart.utils";
import { PendingInvitationEditDialog } from "@/app/components/access/PendingInvitationEditDialog";
import { Button } from "@/components/ui/button";
import { DateTimePicker24h } from "@/components/custom/DateTimePicker24h";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showConfirmDialog } from "@/store/confirm.store";
import { getUserFullName } from "@/auth/actions/session-user";
import { useAuthStore } from "@/auth/store/auth.store";
import { isValidEmail } from "@/utils/validators";

interface DeviceGuestManagementCardProps {
  deviceId: string;
  isOwner: boolean;
  accessContext?: DeviceAccessContext;
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

export function DeviceGuestManagementCard({
  deviceId,
  isOwner,
  accessContext: initialAccessContext,
}: DeviceGuestManagementCardProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [guestEmail, setGuestEmail] = useState("");
  const [accessStartDate, setAccessStartDate] = useState<Date>(createDefaultAccessStart);
  const [editingInvitation, setEditingInvitation] = useState<
    DeviceAccessContext["pendingInvitations"][number] | null
  >(null);

  const { data: queriedAccessContext } = useQuery({
    queryKey: ["device-access-context", deviceId],
    queryFn: () => deviceService.getAccessContext(deviceId),
    enabled: !!deviceId && !initialAccessContext,
  });
  const accessContext = initialAccessContext ?? queriedAccessContext;
  const { data: usersData } = useUsers(
    { page: 1, size: 200, isActive: true },
    { enabled: isOwner && Boolean(user?.isAdmin) },
  );
  const knownUsers = usersData?.items ?? [];
  const normalizedGuestEmail = guestEmail.trim().toLowerCase();
  const isGuestEmailValid = isValidEmail(normalizedGuestEmail);
  const showEmailError = normalizedGuestEmail !== "" && !isGuestEmailValid;

  const invalidateContext = () =>
    queryClient.invalidateQueries({ queryKey: ["device-access-context", deviceId] });

  const inviteGuestMutation = useMutation({
    mutationFn: () => deviceService.inviteGuestByEmail(deviceId, {
      email: normalizedGuestEmail,
      accessStartsAt: toLocalDateTimePayload(accessStartDate),
    }),
    onSuccess: () => {
      toast.success("Invitación enviada correctamente");
      setGuestEmail("");
      setAccessStartDate(createDefaultAccessStart());
      invalidateContext();
    },
    onError: (error: unknown) => toast.error(getErrorDetail(error, "No se pudo enviar la invitación")),
  });
  const deactivateGuestMutation = useMutation({
    mutationFn: (guestUserId: string) => deviceService.deactivateGuestRelation(deviceId, guestUserId),
    onSuccess: () => {
      toast.success("Invitado desasociado del dispositivo");
      invalidateContext();
    },
    onError: () => toast.error("No se pudo desasociar el invitado"),
  });
  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => deviceService.revokeGuestInvitation(deviceId, invitationId),
    onSuccess: () => {
      toast.success("Invitación revocada");
      invalidateContext();
    },
    onError: () => toast.error("No se pudo revocar la invitación"),
  });
  const updateInvitationMutation = useMutation({
    mutationFn: (payload: { invitationId: string; accessStartsAt: string }) =>
      deviceService.updateGuestInvitation(deviceId, payload.invitationId, {
        accessStartsAt: payload.accessStartsAt,
      }),
    onSuccess: () => {
      toast.success("Invitación actualizada");
      invalidateContext();
    },
    onError: (error: unknown) => toast.error(getErrorDetail(error, "No se pudo actualizar la invitación")),
  });

  if (!isOwner) return null;

  const getGuestFullName = (guest: DeviceAccessContext["guests"][number]) => {
    const name = [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim();
    const knownUser = knownUsers.find((candidate) => candidate.id === guest.guestUserId);
    return name || (knownUser ? getUserFullName(knownUser) : undefined);
  };

  const handleInvite = () => {
    if (!isGuestEmailValid) {
      toast.error("Ingresá un correo electrónico válido");
      return;
    }
    showConfirmDialog(`¿Querés enviar la invitación a ${normalizedGuestEmail}?`, async () => {
      try { await inviteGuestMutation.mutateAsync(); } catch { /* handled by mutation */ }
    });
  };

  return (
    <div className="space-y-4 border-t pt-6">
      <div className="space-y-3">
        <h3 className="font-medium">Invitados</h3>
        <div className="space-y-2">
          <Label htmlFor="device-guest-email">Correo electrónico del invitado</Label>
          <Input id="device-guest-email" type="email" placeholder="Ingresá el correo electrónico" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} />
          {showEmailError ? <p className="text-xs text-destructive">Ingresá un correo electrónico válido.</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="device-access-start-date">Acceso desde</Label>
          <DateTimePicker24h id="device-access-start-date" value={accessStartDate} onChange={(date) => setAccessStartDate(date ?? createDefaultAccessStart())} />
        </div>
        <Button type="button" className="w-full sm:w-auto" onClick={handleInvite} disabled={!isGuestEmailValid || inviteGuestMutation.isPending}>
          Enviar invitación
        </Button>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <h3 className="font-medium text-foreground">Invitados del dispositivo</h3>
        {(accessContext?.guests ?? []).length === 0 && (accessContext?.pendingInvitations ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay invitados configurados.</p>
        ) : null}
        {(accessContext?.pendingInvitations ?? []).map((invitation) => {
          const inherited = invitation.scopeType === SCOPE_TYPE.ENVIRONMENT;
          return (
            <div key={`pending-${invitation.id}`} className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium">{invitation.email}</p>
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {inherited ? "Invitación pendiente del establecimiento" : "Pendiente"}
              </span>
              <p className="text-xs text-amber-700">{formatAccessStartLabel(invitation.accessStartsAt)}</p>
              {inherited ? <p className="text-xs text-amber-700">Invitación heredada del establecimiento. Gestionála desde el establecimiento.</p> : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditingInvitation(invitation)} disabled={updateInvitationMutation.isPending}>Editar</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => showConfirmDialog(`¿Querés revocar la invitación pendiente a ${invitation.email}? Esta invitación dejará de estar disponible y ya no podrá usarse para acceder al dispositivo.`, async () => { await revokeInvitationMutation.mutateAsync(invitation.id); })} disabled={revokeInvitationMutation.isPending}>Revocar</Button>
                </div>
              )}
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
        {(accessContext?.guests ?? []).map((guest) => {
          const knownUser = knownUsers.find((candidate) => candidate.id === guest.guestUserId);
          const fullName = getGuestFullName(guest);
          const email = guest.email || knownUser?.email;
          const direct = guest.sourceScope === SCOPE_TYPE.DEVICE;
          return (
            <div key={`guest-${guest.guestUserId}-${guest.sourceScope}`} className="rounded-md border p-3">
              <p className="font-medium">{fullName || email || "Invitado"}</p>
              {email && fullName ? <p className="text-sm text-muted-foreground">{email}</p> : null}
              {guest.phone ? <p className="text-sm text-muted-foreground">{guest.phone}</p> : null}
              <p className="mt-0.5 text-xs text-muted-foreground">{formatAccessStartLabel(guest.accessStartsAt)}</p>
              {direct ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => showConfirmDialog(`¿Querés desasociar a ${fullName || email || "este invitado"} de este dispositivo? Esta persona dejará de ver los movimientos del dispositivo.`, async () => { await deactivateGuestMutation.mutateAsync(guest.guestUserId); })}>Desasociar</Button> : <p className="mt-1 text-sm text-muted-foreground">Acceso heredado del establecimiento</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
