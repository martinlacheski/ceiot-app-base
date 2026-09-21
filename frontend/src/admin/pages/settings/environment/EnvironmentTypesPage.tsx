import { PageHeader } from "@/app/components/PageHeader";
import { EnvironmentTypesTable } from "@/admin/components/settings/environment/EnvironmentTypesTable";

export default function EnvironmentTypesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tipos de Establecimiento"
        subtitle="Gestión de tipos de establecimiento"
      />
      <EnvironmentTypesTable />
    </div>
  );
}
