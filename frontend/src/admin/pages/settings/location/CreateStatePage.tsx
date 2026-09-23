import { BackButton } from "@/components/custom/BackButton";
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StateForm,
  type StateFormValues,
} from "@/admin/components/settings/location/StateForm";
import { useCreateState, useUpdateState } from "@/admin/hooks/useLocations";
import { showConfirmDialog } from "@/store/confirm.store";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export default function CreateStatePage() {
  const navigate = useNavigate();
  const { mutateAsync: createState, isPending } = useCreateState();
  const { mutateAsync: updateState } = useUpdateState();

  const handleSubmit = async (values: StateFormValues) => {
    try {
      await createState(values);
      toast.success("Provincia creada exitosamente");
      navigate("/admin/locations/states");
    } catch (error: any) {
      if (
        error.response?.status === 409 &&
        error.response?.data?.detail?.code === "INACTIVE_DUPLICATE"
      ) {
        const { id } = error.response.data.detail;
        showConfirmDialog(
          "Ya existe una provincia inactiva con este nombre en este país. ¿Deseas habilitarla?",
          async () => {
            try {
              await updateState({ id, data: { is_active: true } });
              toast.success("Provincia habilitada exitosamente");
              navigate("/admin/locations/states");
            } catch {
              toast.error("Error al habilitar provincia");
            }
          }
        );
        return;
      }
      toast.error("Error al crear provincia, error: " + error);
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <BackButton to="/admin/locations/states" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crear Provincia</h1>
          <p className="text-muted-foreground">
            Ingresa los datos para registrar una nueva provincia.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <StateForm
          mode="create"
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/states")}
        />
      </div>
    </div>
  );
}
