import {
  CountryForm,
  type CountryFormValues,
} from "@/admin/components/settings/location/CountryForm";
import { useCreateCountry, useUpdateCountry } from "@/admin/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { showConfirmDialog } from "@/store/confirm.store";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function CreateCountryPage() {
  const navigate = useNavigate();
  const { mutateAsync: createCountry, isPending } = useCreateCountry();
  const { mutateAsync: updateCountry } = useUpdateCountry();

  const handleSubmit = async (values: CountryFormValues) => {
    try {
      await createCountry(values);
      toast.success("País creado exitosamente");
      navigate("/admin/locations/countries");
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (
        err.response?.status === 409 &&
        err.response?.data?.detail?.code === "INACTIVE_DUPLICATE"
      ) {
        const { id } = err.response.data.detail;
        showConfirmDialog(
          "Ya existe un país inactivo con este nombre. ¿Deseas habilitarlo?",
          async () => {
            try {
              await updateCountry({ id, data: { is_active: true } });
              toast.success("País habilitado exitosamente");
              navigate("/admin/locations/countries");
            } catch {
              toast.error("Error al habilitar país");
            }
          }
        );
        return;
      }
      toast.error("Error al crear país, error: " + error);
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/locations/countries">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crear País</h1>
          <p className="text-muted-foreground">
            Ingresa los datos para registrar un nuevo país en el sistema.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <CountryForm
          mode="create"
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/countries")}
        />
      </div>
    </div>
  );
}
