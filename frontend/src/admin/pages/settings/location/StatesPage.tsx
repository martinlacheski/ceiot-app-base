import { PageHeader } from "@/app/components/PageHeader";
import { StatesTable } from "@/admin/components/settings/location/StatesTable";

export default function StatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Provincias" subtitle="Gestión de provincias" />
      <StatesTable />
    </div>
  );
}
