import { PermissionsTable } from "@/admin/components/permissions/PermissionsTable";
import { PageHeader } from "@/app/components/PageHeader";

export const PermissionsPage = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Permisos"
        subtitle="Gestión de roles y permisos de usuarios"
      />
      <PermissionsTable />
    </div>
  );
};
