import { BackButton } from "@/components/custom/BackButton";
import { useNavigate, useParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  EnvironmentForm,
  type EnvironmentFormValues,
} from "@/app/components/environments/EnvironmentForm";
import { PendingInvitationEditDialog } from "@/app/components/access/PendingInvitationEditDialog";
import { environmentService } from "@/app/services/environment.service";
import { deviceService } from "@/app/services/device.service";
import { SCOPE_TYPE, type EnvironmentInvitation } from "@/app/types/access.types";
import { Skeleton } from "@/components/ui/skeleton";
import { showConfirmDialog } from "@/store/confirm.store";
import { DateTimePicker24h } from "@/components/custom/DateTimePicker24h";
import {
  createDefaultAccessStart,
  formatAccessStartLabel,
  toLocalDateTimePayload,
} from "@/app/components/access/accessStart.utils";
import { isValidEmail } from "@/utils/validators";
import { useAuthStore } from "@/auth/store/auth.store";
import { getInvitationStatusLabel } from "@/utils/status-labels";

const INVITATION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  REVOKED: "revoked",
} as const;

const INVITATION_STATUS_STYLES: Record<string, string> = {
  [INVITATION_STATUS.PENDING]: "border-amber-200 bg-amber-50 text-amber-700",
  [INVITATION_STATUS.ACCEPTED]: "border-emerald-200 bg-emerald-50 text-emerald-700",
  [INVITATION_STATUS.DECLINED]: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300",
  [INVITATION_STATUS.REVOKED]: "border-red-200 bg-red-50 text-red-700",
};

const getInvitationStatusClassName = (status: string) =>
  INVITATION_STATUS_STYLES[status] ?? "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300";

const getInvitationItemClassName = (status: string) =>
  status === INVITATION_STATUS.PENDING
    ? "rounded-md border border-amber-200 bg-amber-50 p-3"
    : "rounded-md border p-3";

const canRevokeInvitation = (status: string) =>
  status === INVITATION_STATUS.PENDING || status === INVITATION_STATUS.ACCEPTED;

const CONFLICT_SCOPE = {
  DEVICE: "device",
} as const;

const CONFLICT_TYPE = {
  PENDING_INVITATION: "pending_invitation",
  ACTIVE_RELATION: "active_relation",
} as const;

type ConflictType = (typeof CONFLICT_TYPE)[keyof typeof CONFLICT_TYPE];

const ACTIONABLE_CONFLICT_TYPES = [
  CONFLICT_TYPE.PENDING_INVITATION,
  CONFLICT_TYPE.ACTIVE_RELATION,
] as const;

interface DeviceConflictDetail {
  message?: string;
  conflictScope?: string;
  conflictType?: string;
  invitationId?: string;
  deviceId?: string;
  deviceName?: string | null;
  deviceSerial?: string | null;
}

const getDeviceConflictDetail = (
  error: unknown,
): DeviceConflictDetail | null => {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })
    .response;
  const detail = response?.data?.detail;

  if (
    response?.status !== 409 ||
    typeof detail !== "object" ||
    detail === null ||
    (detail as DeviceConflictDetail).conflictScope !== CONFLICT_SCOPE.DEVICE ||
    !ACTIONABLE_CONFLICT_TYPES.includes(
      (detail as DeviceConflictDetail).conflictType as ConflictType,
    ) ||
    typeof (detail as DeviceConflictDetail).invitationId !== "string" ||
    typeof (detail as DeviceConflictDetail).deviceId !== "string"
  ) {
    return null;
  }

  return detail as DeviceConflictDetail;
};

const getDeviceConflictConfirmationMessage = (conflictDetail: DeviceConflictDetail) => {
  const deviceLabel =
    conflictDetail.deviceName || conflictDetail.deviceSerial || "ese dispositivo";

  return conflictDetail.conflictType === CONFLICT_TYPE.ACTIVE_RELATION
    ? `El usuario ya tiene acceso al dispositivo ${deviceLabel}. ¿Querés revocarlo y enviar la invitación al establecimiento?`
    : `Ya existe una invitación pendiente para este correo electrónico en el dispositivo ${deviceLabel}. ¿Querés revocarla y enviar la invitación al establecimiento?`;
};

const getErrorDetail = (error: unknown, fallback: string) => {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const detail = (error as { response?: { data?: { detail?: unknown } } }).response
    ?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (
    typeof detail === "object" &&
    detail !== null &&
    "message" in detail &&
    typeof (detail as { message?: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }

  return fallback;
};

export function CreateEnvironmentPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = !!id;
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [invitationEmail, setInvitationEmail] = useState("");
  const [accessStartDate, setAccessStartDate] = useState<Date>(createDefaultAccessStart);
  const [editingInvitation, setEditingInvitation] = useState<EnvironmentInvitation | null>(null);

  // Fetch data if edit mode
  const { data: environment, isLoading } = useQuery({
    queryKey: ["environment", id],
    queryFn: () => environmentService.getById(id!),
    enabled: isEditMode,
  });

  const canManageInvitations =
    !!environment && (Boolean(user?.isAdmin) || environment.ownerId === user?.id);
  const normalizedInvitationEmail = invitationEmail.trim().toLowerCase();
  const isInvitationEmailValid = isValidEmail(normalizedInvitationEmail);
  const showEmailError = normalizedInvitationEmail !== "" && !isInvitationEmailValid;

  const { data: invitationsData } = useQuery({
    queryKey: ["environment-guest-invitations", id],
    queryFn: () =>
      environmentService.listInvitations(id!, {
        page: 1,
        perPage: 20,
      }),
    enabled: isEditMode,
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      environmentService.sendInvitation(id!, {
        email: normalizedInvitationEmail,
        accessStartsAt: toLocalDateTimePayload(accessStartDate),
      }),
    onSuccess: () => {
      toast.success("Invitación enviada");
      setInvitationEmail("");
      setAccessStartDate(createDefaultAccessStart());
      queryClient.invalidateQueries({
        queryKey: ["environment-guest-invitations", id],
      });
    },
    onError: (error: unknown) => {
      const conflictDetail = getDeviceConflictDetail(error);
      if (conflictDetail) {
        showConfirmDialog(
          getDeviceConflictConfirmationMessage(conflictDetail),
          async () => {
            try {
              await deviceService.revokeGuestInvitation(
                conflictDetail.deviceId!,
                conflictDetail.invitationId!,
              );
            } catch {
              toast.error("No se pudo revocar la invitación del dispositivo");
              return;
            }

            try {
              await inviteMutation.mutateAsync();
            } catch {
              // React Query already shows the parsed backend message in onError.
            }
          },
        );
        return;
      }

      toast.error(getErrorDetail(error, "No se pudo enviar la invitación"));
    },
  });

  const handleInviteGuest = () => {
    if (!isInvitationEmailValid) {
      toast.error("Ingresá un correo electrónico válido");
      return;
    }

    showConfirmDialog(
      `¿Querés enviar la invitación a ${normalizedInvitationEmail}?`,
      async () => {
        try {
          await inviteMutation.mutateAsync();
        } catch {
          // React Query already shows the parsed backend message in onError.
          // Swallow the rejection so the confirm dialog does not show its generic error.
        }
      },
    );
  };

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) =>
      environmentService.revokeInvitation(id!, invitationId),
    onSuccess: () => {
      toast.success("Invitación revocada");
      queryClient.invalidateQueries({
        queryKey: ["environment-guest-invitations", id],
      });
    },
    onError: (error: unknown) => {
      toast.error(getErrorDetail(error, "No se pudo desasociar la invitación"));
    },
  });

  const updateInvitationMutation = useMutation({
    mutationFn: (payload: { invitationId: string; accessStartsAt: string }) =>
      environmentService.updateInvitation(id!, payload.invitationId, {
        accessStartsAt: payload.accessStartsAt,
      }),
    onSuccess: () => {
      toast.success("Invitación actualizada");
      queryClient.invalidateQueries({
        queryKey: ["environment-guest-invitations", id],
      });
    },
    onError: (error: unknown) => {
      toast.error(getErrorDetail(error, "No se pudo actualizar la invitación"));
    },
  });

  const handleRevokeInvitation = (invitationId: string, email: string) => {
    showConfirmDialog(
      `¿Querés desasociar a ${email} del establecimiento?`,
      async () => {
        try {
          await revokeMutation.mutateAsync(invitationId);
        } catch {
          // React Query already shows the parsed backend message in onError.
          // Swallow the rejection so the confirm dialog does not show its generic error.
        }
      },
    );
  };

  const mutation = useMutation({
    mutationFn: (values: EnvironmentFormValues) => {
      const payload = {
        ...values,
        description: values.description || "",
        isActive: values.isActive ?? true,
      };

      if (isEditMode) {
        return environmentService.update(id!, payload);
      }
      return environmentService.create(payload);
    },
    onSuccess: () => {
      toast.success(
        isEditMode
          ? "Establecimiento actualizado correctamente"
          : "Establecimiento creado correctamente",
      );
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      navigate("/app/environments");
    },
    onError: (error: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      const message = err.response?.data?.detail || "Ha ocurrido un error";

      if (
        typeof message === "object" &&
        message.code === "INACTIVE_DUPLICATE"
      ) {
        toast.error(message.message, {
          description: "Puedes reactivarlo en la lista de inactivos.",
          duration: 5000,
        });
      } else {
        toast.error("Error al guardar el establecimiento", {
          description:
            typeof message === "string" ? message : "Verifique los datos.",
        });
      }
    },
  });

  if (isEditMode && isLoading) {
    return (
      <div className="space-y-6 p-10 pb-16 block">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <BackButton onClick={() => navigate("/app/environments")} />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {isEditMode ? "Editar Establecimiento" : "Nuevo Establecimiento"}
          </h2>
          <p className="text-muted-foreground">
            {isEditMode
              ? "Modifica los datos del establecimiento seleccionado."
              : "Registra un nuevo establecimiento para tus dispositivos."}
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card w-full">
        <EnvironmentForm
          defaultValues={
            environment
              ? {
                  name: environment.name,
                  typeId: environment.typeId,
                  cityId: environment.cityId,
                  address: environment.address,
                  location: environment.location,
                  description: environment.description,
                  phone: environment.phone,
                  isActive: environment.isActive,
                }
              : undefined
          }
          onSubmit={async (values) => {
            try {
              await mutation.mutateAsync(values);
            } catch {
              // Error handled in mutation.onError
            }
          }}
          isSubmitting={mutation.isPending}
          onCancel={() => navigate("/app/environments")}
          submitLabel={isEditMode ? "Guardar Cambios" : "Crear Establecimiento"}
          cancelLabel="Volver"
          afterDescriptionContent={
            isEditMode && canManageInvitations ? (
              <div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" className="w-full sm:w-auto">
                      Gestionar invitados
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Invitados</DialogTitle>
                      <DialogDescription>
                        Gestioná las invitaciones del establecimiento.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                      <div className="space-y-3 rounded-md border p-4">
                        {/* Email — full width */}
                        <div className="space-y-2">
                          <Label htmlFor="environment-guest-email">
                            Correo electrónico del invitado
                          </Label>
                          <Input
                            id="environment-guest-email"
                            type="email"
                            placeholder="Ingresá el correo electrónico"
                            value={invitationEmail}
                            onChange={(event) => setInvitationEmail(event.target.value)}
                          />
                          {showEmailError && (
                            <p className="text-xs text-destructive">
                              Ingresá un correo electrónico válido.
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="environment-guest-access-start">
                            Acceso desde
                          </Label>
                          <DateTimePicker24h
                            id="environment-guest-access-start"
                            value={accessStartDate}
                            onChange={(date) =>
                              setAccessStartDate(date ?? createDefaultAccessStart())
                            }
                          />
                        </div>

                        {/* Submit — full width */}
                        <Button
                          type="button"
                          className="w-full"
                          disabled={!isInvitationEmailValid || inviteMutation.isPending}
                          onClick={handleInviteGuest}
                        >
                          Enviar invitación
                        </Button>
                      </div>

                      <div className="space-y-3 rounded-md border p-4">
                        <h3 className="font-medium">Invitados del establecimiento</h3>
                        {(invitationsData?.items ?? []).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No hay invitaciones pendientes.
                          </p>
                        ) : (
                          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {invitationsData?.items.map((invitation) => {
                              const fullName = [invitation.firstName, invitation.lastName]
                                .filter(Boolean)
                                .join(" ")
                                .trim();
                              const canEditInvitation =
                                invitation.isActive &&
                                invitation.scopeType === SCOPE_TYPE.ENVIRONMENT &&
                                invitation.status.toLowerCase() === INVITATION_STATUS.PENDING;
                              return (
                                <div
                                  key={invitation.id}
                                  className={getInvitationItemClassName(invitation.status)}
                                >
                                  <p className="text-sm font-medium">{fullName || invitation.email}</p>
                                  {fullName ? (
                                    <p className="truncate text-xs text-muted-foreground">{invitation.email}</p>
                                  ) : null}
                                  <div className="mt-0.5 space-y-0.5">
                                    <div>
                                      <Badge
                                        variant="outline"
                                        className={getInvitationStatusClassName(invitation.status)}
                                      >
                                        {getInvitationStatusLabel(invitation.status)}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {formatAccessStartLabel(invitation.accessStartsAt)}
                                    </p>
                                  </div>
                                  {canEditInvitation || canRevokeInvitation(invitation.status) ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {canEditInvitation ? (
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          size="sm"
                                          disabled={updateInvitationMutation.isPending}
                                          onClick={() => setEditingInvitation(invitation)}
                                        >
                                          Editar
                                        </Button>
                                      ) : null}
                                      {canRevokeInvitation(invitation.status) ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={revokeMutation.isPending}
                                          onClick={() =>
                                            handleRevokeInvitation(invitation.id, invitation.email)
                                          }
                                        >
                                          Desasociar
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {editingInvitation ? (
                          <PendingInvitationEditDialog
                            open
                            email={editingInvitation.email}
                            accessStartsAt={editingInvitation.accessStartsAt}
                            isSaving={updateInvitationMutation.isPending}
                            onOpenChange={(open) => {
                              if (!open) setEditingInvitation(null);
                            }}
                            onSave={async (payload) => {
                              await updateInvitationMutation.mutateAsync({
                                invitationId: editingInvitation.id,
                                accessStartsAt: payload.accessStartsAt,
                              });
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
}
