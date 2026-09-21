import {
  CountryForm,
  type CountryFormValues,
} from "@/admin/components/settings/location/CountryForm";
import { useUpdateCountry, useCountry } from "@/admin/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function EditCountryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const countryId = id || "";

  const { data: country, isLoading, error } = useCountry(countryId);
  const { mutateAsync: updateCountry, isPending } = useUpdateCountry();

  if (!countryId) {
    return <div>ID de país inválido</div>;
  }

  const handleSubmit = async (values: CountryFormValues) => {
    try {
      await updateCountry({ id: countryId, data: values });
      toast.success("País actualizado exitosamente");
      navigate("/admin/locations/countries");
    } catch (error) {
      toast.error("Error al actualizar país, error: " + error);
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

  if (error || !country) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <h2 className="text-xl font-semibold">País no encontrado</h2>
        <p className="text-muted-foreground">
          No se pudo cargar la información del país solicitado.
        </p>
        <Button asChild>
          <Link to="/admin/locations/countries">Volver al listado</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col max-w-8xl">
      <div className="flex gap-4 sm:flex-row">
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/locations/countries">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Editar País</h1>
          <p className="text-muted-foreground">
            Modifica los datos de {country.name}.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <CountryForm
          mode="edit"
          key={country.id} // Important: Force re-render when country changes
          defaultValues={country}
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/countries")}
        />
      </div>
    </div>
  );
}
