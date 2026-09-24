import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormPageLayout } from "@/components/custom/FormPageLayout";
import { DeviceForm } from "@/app/components/devices/DeviceForm";
import { DeviceSensorsSection } from "@/app/components/devices/DeviceSensorsSection";
import { DeviceGuestManagementCard } from "@/app/components/access/DeviceGuestManagementCard";
import { useDevice } from "@/app/hooks/useDevices";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeviceUpdate } from "@/app/types/device.types";
import { useAuthStore } from "@/auth/store/auth.store";
import { deviceService } from "@/app/services/device.service";
import { toast } from "sonner";

interface EditDevicePageProps {
  mode?: "admin" | "user";
}

export default function EditDevicePage({
  mode = "admin",
}: EditDevicePageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: device, isLoading: isFetching } = useDevice(id || "");
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const backUrl = mode === "admin" ? "/admin/devices" : "/app/devices";
  const subtitlePrefix =
    mode === "admin" ? "Editando dispositivo" : "Actualizá los datos de";
  const canManageGuests =
    !!device && (user?.isAdmin || device.environment?.ownerId === user?.id);
  const { data: accessContext } = useQuery({
    queryKey: ["device-access-context", id],
    queryFn: () => deviceService.getAccessContext(id!),
    enabled: !!id,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: DeviceUpdate) => deviceService.update(id!, payload),
    onSuccess: () => {
      toast.success("Dispositivo actualizado exitosamente");
      queryClient.invalidateQueries({ queryKey: ["devices", "list"] });
      queryClient.invalidateQueries({ queryKey: ["devices", "detail", id] });
      queryClient.invalidateQueries({ queryKey: ["device-access-context", id] });
      navigate(-1);
    },
    onError: (error: unknown) => {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response
          ?.data?.detail === "string"
          ? (error as { response?: { data?: { detail?: string } } }).response?.data
              ?.detail
          : "Error al actualizar el dispositivo";
      toast.error(detail);
    },
  });

  if (isFetching) {
    return (
      <FormPageLayout
        title="Editar Dispositivo"
        subtitle="Cargando información..."
        backUrl={backUrl}
      >
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </FormPageLayout>
    );
  }

  if (!device) {
    return (
      <FormPageLayout
        title="Error"
        subtitle="Dispositivo no encontrado"
        backUrl={backUrl}
      >
        <div className="p-6">El dispositivo no existe o fue eliminado.</div>
      </FormPageLayout>
    );
  }

  return (
    <FormPageLayout
      title="Editar Dispositivo"
      subtitle={`${subtitlePrefix}: ${device.name}`}
      backUrl={backUrl}
    >
      <DeviceForm
        isEditing
        mode={mode}
        initialData={device}
        isLoading={saveMutation.isPending}
        extraContent={<div className="space-y-4">
          {id && (user?.isAdmin || user?.permissions?.includes("device_sensor:write")) && <DeviceSensorsSection deviceId={id} canManage={Boolean(canManageGuests)} />}
          {id && canManageGuests ? (
            <DeviceGuestManagementCard
              deviceId={id}
              isOwner
              accessContext={accessContext}
            />
          ) : null}
        </div>}
        onSubmit={(data) => saveMutation.mutate(data as DeviceUpdate)}
        onUnpairSuccess={() => navigate(backUrl)}
      />
    </FormPageLayout>
  );
}
