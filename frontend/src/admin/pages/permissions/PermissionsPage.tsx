import { PermissionsTable } from "@/admin/components/permissions/PermissionsTable";
import { PageHeader } from "@/app/components/PageHeader";

export const PermissionsPage = () => {
  return (
    <PageHeader
      title="Permisos"
      subtitle="Gestión de roles y permisos de usuarios"
    >
      <PermissionsTable />
    </PageHeader>
  );
};
