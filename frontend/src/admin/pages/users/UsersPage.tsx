import { UsersTable } from "@/admin/components/users/UsersTable";
import { PageHeader } from "@/app/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

export function UsersPage() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader title="Usuarios" subtitle="Gestión de usuarios del sistema">
        <div className="flex flex-wrap items-center gap-2">
          <UsersTable
            actions={
              <Button onClick={() => navigate("/admin/users/create")}>
                <Plus className="mr-2 size-4" />
                Nuevo Usuario
              </Button>
            }
          />
        </div>
      </PageHeader>
    </div>
  );
}
