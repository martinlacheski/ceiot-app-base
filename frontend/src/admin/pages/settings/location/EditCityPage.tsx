import {
  CityForm,
  type CityFormValues,
} from "@/admin/components/settings/location/CityForm";
import { useLocationCity, useUpdateCity } from "@/admin/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function EditCityPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cityId = id || "";

  const { data: city, isLoading, isError } = useLocationCity(cityId);
  const { mutateAsync: updateCity, isPending } = useUpdateCity();

  const handleSubmit = async (values: CityFormValues) => {
    try {
      await updateCity({ id: cityId, data: values });
      toast.success("Ciudad actualizada exitosamente");
      navigate("/admin/locations/cities");
    } catch (error) {
      toast.error("Error al actualizar ciudad, error: " + error);
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
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
    );
  }

  if (isError || !city) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <h2 className="text-xl font-semibold">Ciudad no encontrada</h2>
        <Button asChild>
          <Link to="/admin/locations/cities">Volver al listado</Link>
        </Button>
      </div>
    );
  }

  // To populate the form correctly with country, we need the state which has the country_id
  // The 'city' object likely has state relationship if fetched via getById.
  // Let's assume city has 'state' object populated or we need to access state.country_id

  // If city.state is available:
  const formDefaultValues = {
    ...city,
    country_id: city.state?.country_id,
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
          <h1 className="text-2xl font-bold tracking-tight">Editar Ciudad</h1>
          <p className="text-muted-foreground">
            Modifica los datos de la ciudad.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <CityForm
          mode="edit"
          defaultValues={formDefaultValues}
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => navigate("/admin/locations/cities")}
        />
      </div>
    </div>
  );
}
