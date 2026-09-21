import {
  StateForm,
  type StateFormValues,
} from "@/admin/components/settings/location/StateForm";
import { useLocationState, useUpdateState } from "@/admin/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function EditStatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const stateId = id || "";

  const { data: state, isLoading, isError } = useLocationState(stateId);
  const { mutateAsync: updateState, isPending } = useUpdateState();

  const handleSubmit = async (values: StateFormValues) => {
    try {
      await updateState({ id: stateId, data: values });
      toast.success("Provincia actualizada exitosamente");
      navigate("/admin/locations/states");
    } catch (error) {
      toast.error("Error al actualizar provincia, error: " + error);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[200px] w-full max-w-2xl rounded-lg" />
      </div>
    );
  }

  if (isError || !state) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <h2 className="text-xl font-semibold">Provincia no encontrada</h2>
        <Button asChild>
          <Link to="/admin/locations/states">Volver al listado</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/locations/states">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Editar Provincia
          </h1>
          <p className="text-muted-foreground">
            Modifica los datos de la provincia.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <StateForm
          mode="edit"
          defaultValues={state}
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/states")}
        />
      </div>
    </div>
  );
}
