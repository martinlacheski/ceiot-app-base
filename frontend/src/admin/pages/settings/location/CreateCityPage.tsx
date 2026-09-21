/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CityForm,
  type CityFormValues,
} from "@/admin/components/settings/location/CityForm";
import { useCreateCity, useUpdateCity } from "@/admin/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { showConfirmDialog } from "@/store/confirm.store";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function CreateCityPage() {
  const navigate = useNavigate();
  const { mutateAsync: createCity, isPending } = useCreateCity();
  const { mutateAsync: updateCity } = useUpdateCity();

  const handleSubmit = async (values: CityFormValues) => {
    try {
      await createCity(values);
      toast.success("Ciudad creada exitosamente");
      navigate("/admin/locations/cities");
    } catch (error: any) {
      if (
        error.response?.status === 409 &&
        error.response?.data?.detail?.code === "INACTIVE_DUPLICATE"
      ) {
        const { id } = error.response.data.detail;
        showConfirmDialog(
          "Ya existe una ciudad inactiva con este nombre en este código postal. ¿Deseas habilitarla?",
          async () => {
            try {
              await updateCity({ id, data: { is_active: true } });
              toast.success("Ciudad habilitada exitosamente");
              navigate("/admin/locations/cities");
            } catch {
              toast.error("Error al habilitar ciudad");
            }
          }
        );
        return;
      }
      toast.error("Error al crear ciudad, error: " + error);
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/locations/cities">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crear Ciudad</h1>
          <p className="text-muted-foreground">
            Ingresa los datos para registrar una nueva ciudad.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <CityForm
          mode="create"
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/cities")}
        />
      </div>
    </div>
  );
}
