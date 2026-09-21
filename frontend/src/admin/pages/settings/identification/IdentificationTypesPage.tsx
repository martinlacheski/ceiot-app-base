import { PageHeader } from "@/app/components/PageHeader";
import { IdentificationTypesTable } from "@/admin/components/settings/identification/IdentificationTypesTable";

export default function IdentificationTypesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tipos de Documento"
        subtitle="Gestión de tipos de identificación (DNI, CUIT, etc.)"
      />
      <IdentificationTypesTable />
    </div>
  );
}
