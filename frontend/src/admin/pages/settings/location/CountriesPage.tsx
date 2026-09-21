import { PageHeader } from "@/app/components/PageHeader";
import { CountriesTable } from "@/admin/components/settings/location/CountriesTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

export default function CountriesPage() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader title="Países" subtitle="Gestión de países del sistema">
        <div className="flex flex-wrap items-center gap-2">
          <CountriesTable
            actions={
              <Button
                onClick={() => navigate("/admin/locations/countries/create")}
              >
                <Plus className="mr-2 size-4" />
                Nuevo País
              </Button>
            }
          />
        </div>
      </PageHeader>
    </div>
  );
}
