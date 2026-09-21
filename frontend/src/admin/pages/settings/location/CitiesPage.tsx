import { PageHeader } from "@/app/components/PageHeader";
import { CitiesTable } from "@/admin/components/settings/location/CitiesTable";
import { useSearchParams } from "react-router";

export default function CitiesPage() {
  const [searchParams] = useSearchParams();
  const stateId = searchParams.get("stateId") || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Ciudades" subtitle="Gestión de ciudades/localidades" />
      <CitiesTable stateId={stateId} />
    </div>
  );
}
